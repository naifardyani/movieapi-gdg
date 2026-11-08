/**
 * Authentication business logic: registration, credential verification,
 * password hashing and token issuing.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/HttpError.js";

const BCRYPT_ROUNDS = 10;

/** Shape returned to clients: never includes the password hash. */
export type PublicUser = {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
};

const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  createdAt: true,
} as const;

export type AuthResult = {
  token: string;
  user: PublicUser;
};

//login signs a jwt token carrying only the user id, and the token will be used to authenticate the user in the future requests
function signToken(userId: string): string {
  const options = { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions;
  return jwt.sign({ sub: userId }, env.JWT_SECRET, options);
}

export async function register(input: {
  email: string;
  password: string;
  username: string;
}): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw new HttpError(409, "An account with that email already exists");
  }

  //password are hashed, so that they are not stored in plain text in the database, enhancing security. The bcrypt library is used for hashing, which is a widely accepted method for securely storing passwords.
  const password = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  return prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      password,
    },
    select: publicUserSelect,
  });
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, username: true, createdAt: true, password: true },
  });

  // Checks the user existence and password validity. If either fails, it throws an HttpError with a 401 status code and a message indicating invalid credentials. This is done to prevent revealing whether the email or password was incorrect, enhancing security.
  if (!user) {
    throw new HttpError(401, "Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.password);
  if (!passwordMatches) {
    throw new HttpError(401, "Invalid email or password");
  }

  const { password: _password, ...publicUser } = user;

  return {
    token: signToken(user.id),
    user: publicUser,
  };
}

export async function getPublicUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    throw new HttpError(404, "User not found");
  }

  return user;
}
