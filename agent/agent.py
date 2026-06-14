import json
import os

import boto3
from aws_bedrock_token_generator import provide_token
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from strands import Agent, tool
from strands.models.openai_responses import OpenAIResponsesModel

REGION = os.environ.get("AWS_REGION", "us-east-1")
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
MEMORY_ID = os.environ.get("AGENTCORE_MEMORY_ID", "")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "")
MODEL_ID = "google.gemma-4-31b"
BASE_URL = f"https://bedrock-mantle.{REGION}.api.aws/openai/v1"

CATEGORIES = ["hr", "finance", "security", "engineering", "operations"]

bedrock_agent = boto3.client("bedrock-agent-runtime", region_name=REGION)

app = BedrockAgentCoreApp()

_agent_cache: dict[str, Agent] = {}


@tool
def knowledge_search(query: str, category: str = "") -> str:
    """社内ドキュメントをナレッジベースから検索します。カテゴリでフィルタリングできます。

    Args:
        query: 検索クエリ（自然言語）
        category: カテゴリフィルタ（hr, finance, security, engineering, operations）。空文字の場合はフィルタなし

    Returns:
        関連ドキュメントのリスト
    """
    kwargs: dict = {
        "knowledgeBaseId": KNOWLEDGE_BASE_ID,
        "retrievalQuery": {"text": query},
        "retrievalConfiguration": {
            "vectorSearchConfiguration": {
                "numberOfResults": 5,
            }
        },
    }

    if category and category in CATEGORIES:
        kwargs["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"] = {
            "equals": {"key": "category", "value": category}
        }

    response = bedrock_agent.retrieve(**kwargs)

    results = []
    for result in response.get("retrievalResults", []):
        content = result.get("content", {}).get("text", "")
        metadata = result.get("metadata", {})
        score = result.get("score", 0)
        location = result.get("location", {}).get("s3Location", {})

        entry: dict = {
            "title": metadata.get("title", ""),
            "category": metadata.get("category", "unknown"),
            "content": content,
            "score": round(score, 4),
        }

        if location.get("uri"):
            entry["s3_uri"] = location["uri"]

        results.append(entry)

    return json.dumps(results, ensure_ascii=False, indent=2)


@tool
def list_categories() -> str:
    """利用可能なドキュメントカテゴリの一覧を返します。

    Returns:
        カテゴリ一覧（hr, finance, security, engineering, operations）
    """
    return json.dumps(CATEGORIES)


SYSTEM_PROMPT = """\
あなたはナレッジ検索アシスタントです。
規程・手順書・ポリシーなどの文書確認が必要な質問に、簡潔で正確に回答してください。

利用可能なツール:
- knowledge_search: ナレッジベースからドキュメントを検索（カテゴリフィルタ対応）
- list_categories: 利用可能なカテゴリ一覧
- aws_knowledge ツール（Gateway経由）: AWS公式ドキュメントの検索。AWSサービスの技術的な質問に使う

回答ルール:
- 社内の規程・手順・ポリシーに関する質問では knowledge_search を使う
- AWSサービスに関する技術的な質問では aws_knowledge ツールを使う
- 挨拶、感謝、相づち、短い雑談ではツールを使わず自然に返答する
- 検索結果の内容に基づいて回答する
- 該当する情報がない場合はその旨を回答する
- 参照したドキュメントのタイトルを明示する
- 社内ドキュメントの検索結果に s3_uri がある場合は、回答末尾に参照元を以下の形式で明示する:
  参照: [ドキュメント名](s3://bucket/key) ← s3_uri をそのままリンクに使う
- AWS公式ドキュメントを参照した場合は、ドキュメントのURLをリンクとして添える
- 日本語で回答する"""


def _create_session_manager(user_id: str, session_id: str):
    if not MEMORY_ID:
        return None
    config = AgentCoreMemoryConfig(
        memory_id=MEMORY_ID,
        actor_id=user_id,
        session_id=session_id,
    )
    return AgentCoreMemorySessionManager(
        agentcore_memory_config=config,
        region_name=REGION,
    )


def _build_agent(user_id: str, session_id: str) -> Agent:
    model = OpenAIResponsesModel(
        model_id=MODEL_ID,
        client_args={"api_key": provide_token(region=REGION), "base_url": BASE_URL},
    )

    session_manager = _create_session_manager(user_id, session_id)

    tools: list = [knowledge_search, list_categories]

    if GATEWAY_URL:
        from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client
        from strands.tools.mcp import MCPClient

        mcp_factory = lambda: aws_iam_streamablehttp_client(
            endpoint=GATEWAY_URL,
            aws_region=REGION,
            aws_service="bedrock-agentcore",
        )
        tools.append(MCPClient(mcp_factory))

    kwargs: dict = {
        "model": model,
        "tools": tools,
        "system_prompt": SYSTEM_PROMPT,
        "callback_handler": None,
    }
    if session_manager:
        kwargs["session_manager"] = session_manager

    return Agent(**kwargs)


def _collect_tool_calls(agent: Agent, start_index: int = 0) -> list[dict]:
    tool_calls = []
    for msg in agent.messages[start_index:]:
        for content in msg.get("content", []):
            if "toolUse" in content:
                tu = content["toolUse"]
                tool_calls.append({
                    "name": tu["name"],
                    "input": tu["input"],
                    "status": "done",
                })
            if "toolResult" in content:
                tr = content["toolResult"]
                result_text = ""
                for c in tr.get("content", []):
                    if "text" in c:
                        result_text = c["text"]
                if tool_calls:
                    tool_calls[-1]["result"] = result_text[:1000]

    return tool_calls


def _tool_call_from_event(event: dict) -> dict | None:
    tool_use = event.get("current_tool_use")
    if not isinstance(tool_use, dict):
        return None

    name = tool_use.get("name")
    if not name:
        return None

    input_value = tool_use.get("input")
    return {
        "name": name,
        "input": input_value if isinstance(input_value, dict) else {},
        "status": "start",
    }


def _stream_event(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


@app.entrypoint
async def invoke(payload):
    message = payload.get("prompt", "")
    session_id = payload.get("sessionId", "default")
    user_id = payload.get("userId", "anonymous")

    cache_key = f"{user_id}:{session_id}"
    if cache_key not in _agent_cache:
        _agent_cache[cache_key] = _build_agent(user_id, session_id)

    agent = _agent_cache[cache_key]
    response_text = ""
    final_result = None
    message_start_index = len(agent.messages)

    async for event in agent.stream_async(message):
        if "data" in event and isinstance(event["data"], str):
            response_text += event["data"]
            yield _stream_event({
                "delta": event["data"],
                "sessionId": session_id,
            })

        tool_call = _tool_call_from_event(event)
        if tool_call:
            yield _stream_event({
                "toolCalls": [tool_call],
                "sessionId": session_id,
            })

        if "result" in event:
            final_result = event["result"]

    if not response_text and final_result is not None:
        response_text = str(final_result)

    tool_calls = _collect_tool_calls(agent, message_start_index)
    yield _stream_event({
        "response": response_text,
        "toolCalls": tool_calls,
        "sessionId": session_id,
    })


if __name__ == "__main__":
    app.run()
