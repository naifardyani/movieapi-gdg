/**
 * Shared Google Gemini client.
 * Only recommendation.service.ts should import this module.
 */
import { GoogleGenAI } from "@google/genai";
import { env } from "./env.js";

export const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
