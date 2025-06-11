"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite";
import { appWriteConfig } from "../appwrite/config";
import { parseStringify } from "../utils";
import { cookies } from "next/headers";
import { avatarPlaceHolderUrl } from "@/constants";
import { redirect } from "next/navigation";

const getUserByEmail = async (email: string) => {
  const { databases } = await createAdminClient();
  const result = await databases.listDocuments(
    appWriteConfig.databaseId,
    appWriteConfig.usersCollectionId,
    [Query.equal("email", [email])]
  );

  return result.total > 0 ? result.documents[0] : null;
};

const handleError = (error: unknown, message: string) => {
  console.log(`Error: ${message}`, error);
  throw error;
};

export const sendEmailOTP = async ({ email }: { email: string }) => {
  const { account } = await createAdminClient();
  try {
    const session = await account.createEmailToken(ID.unique(), email);
    return session.userId;
  } catch (error) {
    handleError(error, "Failed to send email OTP");
  }
};

export const createAccount = async ({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) => {
  const existingUser = await getUserByEmail(email);

  const accountId = await sendEmailOTP({ email });

  if (!accountId) {
    throw new Error("Failed to send an OTP, please try again.");
  }

  if (!existingUser) {
    const { databases } = await createAdminClient();

    await databases.createDocument(
      appWriteConfig.databaseId,
      appWriteConfig.usersCollectionId,
      ID.unique(),
      {
        fullName,
        email,
        avatar: avatarPlaceHolderUrl,
        accountId,
      }
    );
  }

  return parseStringify({ accountId });
};

export const verifySecret = async ({
  accountId,
  password,
}: {
  accountId: string;
  password: string;
}) => {
  try {
    const { account } = await createAdminClient();

    const session = await account.createSession(accountId, password);

    (await cookies()).set("appwrite_session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    return parseStringify({ sessionId: session.$id });
  } catch (error) {
    handleError(error, "Failed to verify OTP");
  }
};

export const getCurrentUser = async () => {
  try {
    const sessionCookie = (await cookies()).get("appwrite_session");
    if (!sessionCookie || !sessionCookie.value) {
      return null;
    }

    const { account, databases } = await createSessionClient();
    const result = await account.get();
    if (!result) {
      return null;
    }
    const user = await databases.listDocuments(
      appWriteConfig.databaseId,
      appWriteConfig.usersCollectionId,
      [Query.equal("accountId", result.$id)]
    );
    if (user.total < 1) {
      return null;
    }

    return parseStringify(user.documents[0]);
  } catch (error) {
    handleError(error, "Failed to get current user");
  }
};

export const signOutUser = async () => {
  const { account } = await createSessionClient();
  try {
    // Log out the user from the current session
    await account.deleteSession("current");
    (await cookies()).delete("appwrite_session");
  } catch (error) {
    handleError(error, "Failed to sign out user");
  } finally {
    redirect("/sign-in");
  }
};

export const signInUser = async ({ email }: { email: string }) => {
  try {
    const existingUser = await getUserByEmail(email);

    // User exists, send OTP
    if (existingUser) {
      await sendEmailOTP({ email });
      return parseStringify({
        accountId: existingUser.accountId,
      });
    }
    return parseStringify({ accountId: null, error: "User not found" });
  } catch (error) {
    handleError(error, "Failed to sign in user");
  }
};
