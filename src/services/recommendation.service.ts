/**
 * Gemini-backed recommendation service.
 *
 * The model is constrained to pick exactly one movie from the local catalogue
 * and to answer with structured JSON. The returned id is re-validated against
 * the database, so a hallucinated id becomes a clean 422 instead of a bogus
 * recommendation.
 */
import { Type } from "@google/genai";
import { env } from "../config/env.js";
import { genai } from "../config/gemini.js";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/HttpError.js";

export type Recommendation = {
  movie_id: number;
  reasoning: string;
  movie: {
    id: number;
    title: string;
    year: number;
    director: string;
    genres: string[];
    rating: number;
    duration: string;
    synopsis: string;
    poster_url: string;
    cast: string[];
  };
};

type CatalogueEntry = {
  id: number;
  title: string;
  year: number;
  director: string;
  genres: string[];
  synopsis: string;
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    movie_id: {
      type: Type.INTEGER,
      description: "The id of the single chosen movie, copied from the catalogue.",
    },
    reasoning: {
      type: Type.STRING,
      description: "Why this movie fits the user's request, in the user's language.",
    },
  },
  required: ["movie_id", "reasoning"],
} as const;

function buildPrompt(prompt: string, catalogue: CatalogueEntry[]): string {
  return [
    "You are a movie recommendation engine for a small curated catalogue.",
    "",
    "RULES:",
    "1. Choose exactly ONE movie from the CATALOGUE below.",
    "2. `movie_id` MUST be an id that appears in the catalogue. Never invent one.",
    "3. If nothing is a perfect match, pick the closest one and explain the compromise.",
    "4. `reasoning` must be 2-4 sentences in the same language as the user's request.",
    "",
    "CATALOGUE:",
    JSON.stringify(catalogue, null, 2),
    "",
    "USER REQUEST:",
    prompt,
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extracts { movie_id, reasoning } from the model output, or throws 502. */
function parseModelOutput(text: string | undefined): { movie_id: number; reasoning: string } {
  if (!text || text.trim() === "") {
    throw new HttpError(502, "The AI service returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(502, "The AI service returned malformed JSON");
  }

  if (!isRecord(parsed)) {
    throw new HttpError(502, "The AI service returned an unexpected response");
  }

  const movieId = parsed["movie_id"];
  const reasoning = parsed["reasoning"];

  if (typeof movieId !== "number" || !Number.isInteger(movieId)) {
    throw new HttpError(502, "The AI service did not return a valid movie_id");
  }

  if (typeof reasoning !== "string" || reasoning.trim() === "") {
    throw new HttpError(502, "The AI service did not return a valid reasoning");
  }

  return { movie_id: movieId, reasoning: reasoning.trim() };
}

/** Maps Google API failures onto a semantic HTTP status. */
function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (/API key not valid|API_KEY_INVALID|unauthenticated/i.test(message)) {
    return new HttpError(502, "The configured Gemini API key was rejected by Google");
  }
  if (/no longer available|NOT_FOUND|not found for API version|is not supported/i.test(message)) {
    return new HttpError(502, "The configured Gemini model is unavailable; set GEMINI_MODEL to a supported model");
  }
  if (/quota|RESOURCE_EXHAUSTED|rate limit/i.test(message)) {
    return new HttpError(503, "The AI service is rate limited; please retry shortly");
  }

  console.error("[recommendation] Gemini call failed:", error);
  return new HttpError(502, "The AI service is currently unavailable");
}

export async function recommendMovie(prompt: string): Promise<Recommendation> {
  const catalogue = await prisma.movie.findMany({
    select: { id: true, title: true, year: true, director: true, genres: true, synopsis: true },
    orderBy: { id: "asc" },
  });

  if (catalogue.length === 0) {
    throw new HttpError(503, "The movie catalogue is empty; seed the database first");
  }

  let output: string | undefined;
  try {
    const response = await genai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: buildPrompt(prompt, catalogue),
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.4,
      },
    });
    output = response.text;
  } catch (error) {
    throw toHttpError(error);
  }

  const parsed = parseModelOutput(output);

  // Hard guard: the id must exist in the catalogue we actually offered.
  const movie = await prisma.movie.findUnique({ where: { id: parsed.movie_id } });

  if (!movie) {
    throw new HttpError(422, "The AI recommended a movie outside the catalogue; please retry");
  }

  return {
    movie_id: movie.id,
    reasoning: parsed.reasoning,
    movie,
  };
}
