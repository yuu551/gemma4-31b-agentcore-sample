import json
import os
import time
from datetime import datetime

import boto3
from boto3.dynamodb.conditions import Key

MEMORY_ID = os.environ["MEMORY_ID"]
SESSION_TABLE_NAME = os.environ["SESSION_TABLE_NAME"]
MAX_SESSIONS = 50
MAX_EVENT_PAGES = 10

client = boto3.client("bedrock-agentcore")
dynamodb = boto3.resource("dynamodb")
session_table = dynamodb.Table(SESSION_TABLE_NAME)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        },
        "body": json.dumps(body, ensure_ascii=False),
    }


def iso_timestamp(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if value is None:
        return ""
    return str(value)


def timestamp_ms(value):
    if isinstance(value, datetime):
        return int(value.timestamp() * 1000)
    if not value:
        return 0
    try:
        return int(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return 0


def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def as_text(value, limit):
    if value is None:
        return ""
    return str(value).strip()[:limit]


def as_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def user_pk(actor_id):
    return f"USER#{actor_id}"


def session_sk(session_id):
    return f"SESSION#{session_id}"


def parse_json_text(value):
    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text or text[0] not in "[{\"":
        return value

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def text_from_content(value):
    value = parse_json_text(value)

    if isinstance(value, str):
        return value

    if isinstance(value, list):
        parts = []
        for item in value:
            text = text_from_content(item)
            if text:
                parts.append(text)
        return "\n".join(parts)

    if isinstance(value, dict):
        if isinstance(value.get("text"), str):
            return value["text"]
        if "content" in value:
            return text_from_content(value["content"])
        if "message" in value:
            return text_from_content(value["message"])

    return ""


def tool_result_text(value):
    value = parse_json_text(value)
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(filter(None, [tool_result_text(item) for item in value]))
    if isinstance(value, dict):
        if isinstance(value.get("text"), str):
            return value["text"]
        if "content" in value:
            return tool_result_text(value["content"])
    return ""


def tool_calls_from_content(value):
    value = parse_json_text(value)
    tool_calls = []

    if isinstance(value, list):
        for item in value:
            tool_calls.extend(tool_calls_from_content(item))
        return tool_calls

    if not isinstance(value, dict):
        return tool_calls

    if isinstance(value.get("message"), dict):
        return tool_calls_from_content(value["message"].get("content"))

    if isinstance(value.get("toolUse"), dict):
        tool_use = value["toolUse"]
        name = tool_use.get("name")
        if name:
            input_value = tool_use.get("input")
            tool_calls.append({
                "name": str(name),
                "input": input_value if isinstance(input_value, dict) else {},
                "status": "done",
            })

    if isinstance(value.get("toolResult"), dict):
        result_text = tool_result_text(value["toolResult"].get("content"))
        if result_text:
            tool_calls.append({
                "name": str(value["toolResult"].get("toolUseId") or "tool"),
                "input": {},
                "result": result_text[:1000],
                "status": "done",
                "_resultOnly": True,
            })

    if "content" in value:
        tool_calls.extend(tool_calls_from_content(value["content"]))

    return tool_calls


def merge_tool_results(tool_calls):
    merged = []
    for tool_call in tool_calls:
        if tool_call.pop("_resultOnly", False):
            if merged and not merged[-1].get("result"):
                merged[-1]["result"] = tool_call.get("result", "")
            continue
        merged.append(tool_call)
    return merged


def message_from_text(default_role, text):
    parsed = parse_json_text(text)
    tool_calls = merge_tool_results(tool_calls_from_content(parsed))

    if isinstance(parsed, dict):
        message = parsed.get("message")
        if isinstance(message, dict):
            role = str(message.get("role") or default_role).lower()
            content = text_from_content(message.get("content"))
            if not tool_calls:
                tool_calls = merge_tool_results(tool_calls_from_content(message.get("content")))
            return role, content, tool_calls

        role = str(parsed.get("role") or default_role).lower()
        content = text_from_content(parsed.get("content") or parsed.get("text") or parsed)
        return role, content, tool_calls

    return default_role, text_from_content(parsed), tool_calls


def actor_id_from_event(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    actor_id = claims.get("sub") or claims.get("cognito:username") or claims.get("username")
    return as_text(actor_id, 240)


def list_events(actor_id, session_id, include_payloads=True, max_results=100):
    events = []
    next_token = None

    for _ in range(MAX_EVENT_PAGES):
        kwargs = {
            "memoryId": MEMORY_ID,
            "actorId": actor_id,
            "sessionId": session_id,
            "includePayloads": include_payloads,
            "maxResults": max_results,
        }
        if next_token:
            kwargs["nextToken"] = next_token

        result = client.list_events(**kwargs)
        events.extend(result.get("events", []))
        next_token = result.get("nextToken")
        if not next_token:
            break

    return sorted(events, key=lambda item: timestamp_ms(item.get("eventTimestamp")))


def conversational_payloads(event):
    timestamp = timestamp_ms(event.get("eventTimestamp"))
    messages = []

    for index, payload in enumerate(event.get("payload") or []):
        conversational = payload.get("conversational") if isinstance(payload, dict) else None
        if not isinstance(conversational, dict):
            continue

        content = conversational.get("content") or {}
        raw_text = content.get("text") if isinstance(content, dict) else ""
        role, text, tool_calls = message_from_text(
            str(conversational.get("role") or "").lower(),
            raw_text,
        )

        if role not in ("user", "assistant") or (not text and not tool_calls):
            continue

        message = {
            "id": f"{event.get('eventId', 'event')}-{index}",
            "role": role,
            "content": as_text(text, 100000),
            "timestamp": timestamp,
        }
        if tool_calls:
            message["toolCalls"] = tool_calls
        messages.append(message)

    return messages


def messages_from_events(events):
    messages = []
    pending_tool_calls = []

    for event in events:
        for message in conversational_payloads(event):
            tool_calls = message.pop("toolCalls", [])
            if tool_calls:
                pending_tool_calls.extend(tool_calls)

            if not message.get("content"):
                continue

            if message["role"] == "assistant" and pending_tool_calls:
                message["toolCalls"] = merge_tool_results(pending_tool_calls)
                pending_tool_calls = []

            messages.append(message)

    if pending_tool_calls:
        for message in reversed(messages):
            if message["role"] == "assistant":
                message["toolCalls"] = merge_tool_results([
                    *message.get("toolCalls", []),
                    *pending_tool_calls,
                ])
                break

    return messages


def session_from_item(item):
    return {
        "id": item.get("sessionId", ""),
        "title": item.get("title") or "履歴",
        "lastMessage": item.get("lastMessage") or "",
        "timestamp": as_int(item.get("updatedAtEpoch")),
        "createdAt": item.get("createdAt") or "",
        "updatedAt": item.get("updatedAt") or "",
        "category": item.get("category") or "",
        "messageCount": as_int(item.get("messageCount")),
        "toolCallCount": as_int(item.get("toolCallCount")),
    }


def query_session_metadata(actor_id):
    result = session_table.query(
        IndexName="ByUpdatedAt",
        KeyConditionExpression=Key("gsi1pk").eq(user_pk(actor_id)),
        ScanIndexForward=False,
        Limit=MAX_SESSIONS,
    )
    sessions = [
        session_from_item(item)
        for item in result.get("Items", [])
        if not item.get("deletedAt") and item.get("sessionId")
    ]
    return sessions[:MAX_SESSIONS]


def upsert_session_metadata(actor_id, session_id, payload):
    now = now_iso()
    updated_at_epoch = as_int(payload.get("timestamp")) or int(time.time() * 1000)
    key = {
        "pk": user_pk(actor_id),
        "sk": session_sk(session_id),
    }
    existing = session_table.get_item(Key=key).get("Item", {})
    created_at = existing.get("createdAt") or now
    title = as_text(payload.get("title") or "新しい検索", 120)
    last_message = as_text(payload.get("lastMessage"), 240)
    category = as_text(payload.get("category"), 80)

    item = {
        **key,
        "gsi1pk": user_pk(actor_id),
        "gsi1sk": f"{updated_at_epoch:013d}#{session_id}",
        "sessionId": session_id,
        "userId": actor_id,
        "title": title,
        "lastMessage": last_message,
        "category": category,
        "messageCount": as_int(payload.get("messageCount")),
        "toolCallCount": as_int(payload.get("toolCallCount")),
        "createdAt": created_at,
        "updatedAt": now,
        "updatedAtEpoch": updated_at_epoch,
        "ttl": int(time.time()) + 60 * 60 * 24 * 180,
    }
    session_table.put_item(Item=item)
    return session_from_item(item)


def delete_session_metadata(actor_id, session_id):
    session_table.delete_item(
        Key={
            "pk": user_pk(actor_id),
            "sk": session_sk(session_id),
        },
    )


def handle_list_sessions(actor_id):
    return response(200, {"sessions": query_session_metadata(actor_id)})


def handle_upsert_session_metadata(actor_id, session_id, event):
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"message": "Invalid JSON body"})

    item = upsert_session_metadata(actor_id, session_id, payload)
    return response(200, {"session": item})


def handle_list_session_events(actor_id, session_id):
    events = list_events(actor_id, session_id, include_payloads=True)
    return response(200, {"messages": messages_from_events(events)})


def handle_delete_session(actor_id, session_id):
    events = list_events(actor_id, session_id, include_payloads=False)

    for event in events:
        event_id = event.get("eventId")
        if not event_id:
            continue
        client.delete_event(
            memoryId=MEMORY_ID,
            actorId=actor_id,
            sessionId=session_id,
            eventId=event_id,
        )

    delete_session_metadata(actor_id, session_id)
    return response(200, {"deletedEvents": len(events)})


def handler(event, context):
    method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method")
    if method == "OPTIONS":
        return response(204, {})

    actor_id = actor_id_from_event(event)
    if not MEMORY_ID:
        return response(500, {"message": "Memory is not configured"})
    if not actor_id:
        return response(401, {"message": "Unauthorized"})

    path_parameters = event.get("pathParameters") or {}
    session_id = as_text(path_parameters.get("sessionId"), 160)

    try:
        if method == "GET" and not session_id:
            return handle_list_sessions(actor_id)
        if method == "GET" and session_id:
            return handle_list_session_events(actor_id, session_id)
        if method == "POST" and session_id:
            return handle_upsert_session_metadata(actor_id, session_id, event)
        if method == "DELETE" and session_id:
            return handle_delete_session(actor_id, session_id)
        return response(405, {"message": "Method not allowed"})
    except client.exceptions.ResourceNotFoundException:
        return response(404, {"message": "Session not found"})
    except client.exceptions.AccessDeniedException:
        return response(403, {"message": "Access denied"})
    except Exception as exc:
        return response(500, {"message": str(exc)})
