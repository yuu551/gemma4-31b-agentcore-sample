import json
import os
import time
import uuid
from datetime import datetime, timezone

import boto3

TABLE_NAME = os.environ["TABLE_NAME"]
MAX_COMMENT = 1000
MAX_QUESTION = 1200
MAX_ANSWER = 1600

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        "body": json.dumps(body, ensure_ascii=False),
    }


def as_text(value, limit):
    if value is None:
        return ""
    return str(value).strip()[:limit]


def as_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def handler(event, context):
    method = (
        event.get("httpMethod")
        or event.get("requestContext", {}).get("http", {}).get("method")
    )
    if method == "OPTIONS":
        return response(204, {})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"message": "Invalid JSON body"})

    session_id = as_text(payload.get("sessionId"), 160)
    message_id = as_text(payload.get("messageId"), 120)
    rating = as_text(payload.get("rating"), 20)
    comment = as_text(payload.get("comment"), MAX_COMMENT)

    if not session_id or not message_id:
        return response(400, {"message": "sessionId and messageId are required"})
    if rating not in ("like", "dislike", "comment"):
        return response(400, {"message": "rating must be like, dislike, or comment"})
    if rating == "comment" and not comment:
        return response(400, {"message": "comment is required"})

    request_context = event.get("requestContext", {})
    authorizer = request_context.get("authorizer", {})
    claims = authorizer.get("claims", {})
    user_id = as_text(
        claims.get("sub")
        or claims.get("cognito:username")
        or claims.get("username")
        or "unknown",
        240,
    )
    now = datetime.now(timezone.utc).isoformat()
    feedback_id = str(uuid.uuid4())

    item = {
        "pk": f"SESSION#{session_id}",
        "sk": f"MESSAGE#{message_id}",
        "gsi1pk": "FEEDBACK",
        "feedbackId": feedback_id,
        "sessionId": session_id,
        "messageId": message_id,
        "rating": rating,
        "comment": comment,
        "category": as_text(payload.get("category"), 80),
        "question": as_text(payload.get("question"), MAX_QUESTION),
        "answerPreview": as_text(payload.get("answerPreview"), MAX_ANSWER),
        "toolCallCount": as_int(payload.get("toolCallCount")),
        "userId": user_id,
        "username": as_text(claims.get("cognito:username") or claims.get("username"), 240),
        "email": as_text(claims.get("email"), 320),
        "sourceIp": as_text(
            request_context.get("identity", {}).get("sourceIp")
            or request_context.get("http", {}).get("sourceIp"),
            80,
        ),
        "userAgent": as_text(
            request_context.get("identity", {}).get("userAgent")
            or request_context.get("http", {}).get("userAgent"),
            512,
        ),
        "createdAt": now,
        "ttl": int(time.time()) + 60 * 60 * 24 * 180,
    }

    table.put_item(Item=item)
    return response(200, {"feedbackId": feedback_id, "createdAt": now})
