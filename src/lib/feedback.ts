import { fetchAuthSession } from "aws-amplify/auth";
import outputs from "../../amplify_outputs.json";
import type { Category } from "../types/chat";

const customOutputs = outputs.custom as Record<string, string | undefined> | undefined;
const FEEDBACK_URL = customOutputs?.feedback_url ?? "";

export type FeedbackRating = "like" | "dislike" | "comment";

export type FeedbackPayload = {
  sessionId: string;
  messageId: string;
  rating: FeedbackRating;
  comment?: string;
  question?: string;
  answerPreview: string;
  category?: Category | null;
  toolCallCount: number;
};

async function getIdToken(forceRefresh = false): Promise<string> {
  const session = await fetchAuthSession({ forceRefresh });
  const token = session.tokens?.idToken?.toString();
  if (!token) {
    throw new Error("Cognito ID token is not available");
  }
  return token;
}

async function postFeedback(body: string, idToken: string): Promise<Response> {
  return fetch(FEEDBACK_URL, {
    method: "POST",
    headers: {
      Authorization: idToken,
      "Content-Type": "application/json",
    },
    body,
  });
}

export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  if (!FEEDBACK_URL) {
    throw new Error("Feedback endpoint is not configured");
  }

  const body = JSON.stringify({
    ...payload,
    answerPreview: payload.answerPreview.slice(0, 1600),
    question: payload.question?.slice(0, 1200) ?? "",
    comment: payload.comment?.slice(0, 1000) ?? "",
  });

  let response = await postFeedback(body, await getIdToken());
  if (response.status === 401) {
    response = await postFeedback(body, await getIdToken(true));
  }

  if (!response.ok) {
    let message = `Feedback failed: ${response.status}`;
    try {
      const error = await response.json();
      if (typeof error?.message === "string") message = error.message;
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new Error(message);
  }
}
