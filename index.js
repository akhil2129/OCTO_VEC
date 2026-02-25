import { config } from "dotenv";
import { join } from "node:path";
import {
    AuthStorage,
    createAgentSession,
    ModelRegistry,
    SessionManager,
    createCodingTools
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Type } from "@sinclair/typebox";

config();

// ────────────────────────────────────────────────
// Custom Tools
// ────────────────────────────────────────────────

const GreetSchema = Type.Object({
    name: Type.String({ description: "Name to greet" }),
});

const greetTool = {
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: GreetSchema,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
        return {
            content: [{ type: "text", text: `Hello, ${params.name}!` }],
            details: {},
        };
    },
};

// ────────────────────────────────────────────────
// Main Logic Wrapper
// ────────────────────────────────────────────────

async function main() {
    const rl = readline.createInterface({ input, output });

    // Paths (relative to current working directory)
    const cwd = process.cwd();

    // Initialize storage & registry
    const authStorage = new AuthStorage("./auth.json");
    const modelRegistry = new ModelRegistry(authStorage, "./models.json");

    // Select model
    const model = getModel("groq", "moonshotai/kimi-k2-instruct-0905");
    if (!model) {
        throw new Error("Model not found – check your key/provider config");
    }

    process.stdout.write(`Selected model: ${model.id}\n`);

    // Create the agent session
    const { session } = await createAgentSession({
        agentDir: cwd,
        sessionManager: SessionManager.inMemory(),
        authStorage,
        modelRegistry,
        model,
        tools: createCodingTools(cwd),
        customTools: [greetTool]
    });

    session.agent.setSystemPrompt(
        "You are a Senior Security Researcher. Your Name is Vec-alpha. " +
        "You have access to default Read,write,Edit etc.. tools. " +
        "Try to be proactive to user by asking their needs, instead of general greetings."
    );

    let isStreaming = false;
    let turnInProgress = false;

    session.subscribe((event) => {
        if (event.type === "message_update") {
            const msgEvent = event.assistantMessageEvent;
            if (msgEvent?.type === "text_delta" || msgEvent?.type === "thought_delta") {
                const delta = (msgEvent.delta || "").replace(/\r/g, ""); // Clean carriage returns
                process.stdout.write(delta);
                isStreaming = true;
            }
        }

        if (event.type === "message_done") {
            process.stdout.write("\n");
        }

        if (event.type === "tool_execution_start") {
            process.stdout.write(`\n[Tool: ${event.toolName}]\n`);
        }

        if (event.type === "agent_idle") {
            isStreaming = false;
            turnInProgress = false;
        }
    });

    while (true) {
        // Pause readline while waiting for input if needed, 
        // but rl.question does it by itself.
        const userInput = await rl.question("\nYou: ");

        if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
            process.stdout.write("Exiting...\n");
            rl.close();
            process.exit(0);
        }

        process.stdout.write("\nAssistant:\n");
        isStreaming = false;
        turnInProgress = true;

        try {
            await session.prompt(userInput);

            // Safety: if prompt resolves but agent_idle haven't fired yet
            while (turnInProgress) {
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (err) {
            process.stdout.write(`\nError: ${err.message}\n`);
            turnInProgress = false;
        }
    }
}

// Start the app and handle top-level errors
main().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});