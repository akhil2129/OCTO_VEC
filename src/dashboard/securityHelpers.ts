/**
 * Thin wrappers so security.ts doesn't import from 'crypto' and 'fs' directly
 * (avoids naming collisions with Express type imports).
 */

import crypto from "crypto";
import fs from "fs";

export function randomBytes(len: number): string {
  return crypto.randomBytes(len).toString("hex");
}

export function existsSync(p: string): boolean {
  return fs.existsSync(p);
}

export function readFileSync(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

export function writeFileSync(p: string, data: string): void {
  fs.writeFileSync(p, data, "utf-8");
}

export function mkdirSync(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}
