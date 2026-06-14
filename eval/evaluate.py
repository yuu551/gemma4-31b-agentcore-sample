"""RAG品質評価スクリプト — LLM-as-a-Judge (Gemma 4 31B)

Usage:
    uv run python eval/evaluate.py \
        --runtime-arn <RUNTIME_ARN> \
        --region us-east-1
"""

import argparse
import json
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import boto3
from aws_bedrock_token_generator import provide_token
from openai import OpenAI

JUDGE_MODEL_ID = "google.gemma-4-31b"

JUDGE_PROMPT = """\
あなたはRAGシステムの品質を評価する審査員です。
以下の情報をもとに、RAGシステムの回答を3つの観点で1〜5のスコアで評価してください。

## 評価対象
- 質問: {question}
- 正解（期待される回答）: {ground_truth}
- 期待されるドキュメント: {expected_doc}
- RAGシステムの回答: {answer}

## 評価観点

### 1. Faithfulness（忠実性）
回答がナレッジベースの情報に基づいているか。ハルシネーション（捏造）がないか。
- 5: 完全に文書の内容に基づいている
- 3: 概ね正確だが一部に根拠不明の情報がある
- 1: 文書にない情報を捏造している

### 2. Relevancy（関連性）
質問に対して適切な回答になっているか。正しいドキュメントを参照しているか。
- 5: 質問に直接的・具体的に回答し、正しいドキュメントを参照
- 3: 回答はしているが、焦点がずれている
- 1: 質問と無関係な回答

### 3. Completeness（完全性）
正解に含まれる情報を網羅しているか。
- 5: 正解の情報を全て含み、追加の有用な情報もある
- 3: 正解の主要な情報は含むが、一部欠落
- 1: 正解の重要な情報が大幅に欠落

## 出力形式
以下のJSON形式のみで回答してください。他のテキストは一切出力しないでください。

```json
{{
  "faithfulness": <1-5>,
  "relevancy": <1-5>,
  "completeness": <1-5>,
  "reasoning": "<評価理由を1-2文で>"
}}
```"""


def parse_agent_response(raw: str) -> dict:
    deltas = []
    tool_calls = []
    final_response = ""

    for line in raw.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("data:"):
            line = line[5:].strip()
        if not line or line == "[DONE]":
            continue

        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue

        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                continue

        if isinstance(payload, dict):
            if "response" in payload:
                final_response = payload["response"]
                tool_calls = payload.get("toolCalls", [])
            elif "delta" in payload:
                deltas.append(payload["delta"])
            if "toolCalls" in payload and not tool_calls:
                tool_calls = payload["toolCalls"]

    if final_response:
        return {"response": final_response, "toolCalls": tool_calls}
    if deltas:
        return {"response": "".join(deltas), "toolCalls": tool_calls}

    return {"response": "", "toolCalls": []}


def build_agent_payload(question: str, category: str) -> tuple[str, str]:
    prompt = question
    if category:
        prompt = f"検索対象カテゴリ: {category}\n質問: {question}"

    session_id = str(uuid.uuid4()) + str(uuid.uuid4())[:1]
    payload = json.dumps({
        "prompt": prompt,
        "sessionId": session_id,
        "userId": "evaluator",
    })
    return session_id, payload


def invoke_rag_agent(client, runtime_arn: str, question: str, category: str) -> dict:
    session_id, payload = build_agent_payload(question, category)
    response = client.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        runtimeSessionId=session_id,
        payload=payload.encode("utf-8"),
        contentType="application/json",
        accept="application/json",
    )

    raw = response["response"].read().decode("utf-8")
    return parse_agent_response(raw)


def invoke_rag_agent_with_token(region: str, runtime_arn: str, access_token: str, question: str, category: str) -> dict:
    session_id, payload = build_agent_payload(question, category)
    url = (
        f"https://bedrock-agentcore.{region}.amazonaws.com"
        f"/runtimes/{urllib.parse.quote(runtime_arn, safe='')}/invocations?qualifier=DEFAULT"
    )
    request = urllib.request.Request(
        url,
        data=payload.encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AgentCore HTTP {e.code}: {body}") from e

    return parse_agent_response(raw)


def judge_answer(openai_client: OpenAI, question: dict, answer: str) -> dict:
    prompt = JUDGE_PROMPT.format(
        question=question["question"],
        ground_truth=question["ground_truth"],
        expected_doc=question["expected_doc"],
        answer=answer,
    )

    response = openai_client.chat.completions.create(
        model=JUDGE_MODEL_ID,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1024,
        extra_body={"reasoning_effort": "high"},
    )

    text = response.choices[0].message.content.strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])

    return {"faithfulness": 0, "relevancy": 0, "completeness": 0, "reasoning": f"Parse error: {text[:100]}"}


def main():
    parser = argparse.ArgumentParser(description="RAG Quality Evaluation with LLM-as-a-Judge")
    parser.add_argument("--runtime-arn", required=True, help="AgentCore Runtime ARN")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--access-token", help="Cognito access token for Cognito-protected AgentCore Runtime")
    parser.add_argument("--questions", default=str(Path(__file__).parent / "questions.json"))
    parser.add_argument("--output", default=str(Path(__file__).parent / "results.json"))
    args = parser.parse_args()

    questions = json.loads(Path(args.questions).read_text())
    agentcore = boto3.client("bedrock-agentcore", region_name=args.region)

    base_url = f"https://bedrock-mantle.{args.region}.api.aws/openai/v1"
    token = provide_token(region=args.region)
    openai_client = OpenAI(api_key=token, base_url=base_url)

    results = []
    scores = {"faithfulness": [], "relevancy": [], "completeness": []}

    print(f"Evaluating {len(questions)} questions...")
    print("=" * 70)

    for i, q in enumerate(questions, 1):
        print(f"\n[{i}/{len(questions)}] {q['id']}: {q['question'][:40]}...")

        try:
            t0 = time.time()
            if args.access_token:
                rag_result = invoke_rag_agent_with_token(
                    args.region,
                    args.runtime_arn,
                    args.access_token,
                    q["question"],
                    q.get("category", ""),
                )
            else:
                rag_result = invoke_rag_agent(agentcore, args.runtime_arn, q["question"], q.get("category", ""))
            rag_time = time.time() - t0
            answer = rag_result.get("response", "")
            tool_calls = rag_result.get("toolCalls", [])
            print(f"  RAG応答: {len(answer)}文字, {len(tool_calls)}ツール呼出, {rag_time:.1f}秒")
            print(f"  回答冒頭: {answer[:80]}...")
        except Exception as e:
            print(f"  RAGエラー: {e}")
            answer = f"Error: {e}"
            tool_calls = []
            rag_time = 0

        try:
            t0 = time.time()
            evaluation = judge_answer(openai_client, q, answer)
            judge_time = time.time() - t0
            print(f"  評価: F={evaluation['faithfulness']} R={evaluation['relevancy']} C={evaluation['completeness']} ({judge_time:.1f}秒)")
            print(f"  理由: {evaluation.get('reasoning', '')[:80]}")
        except Exception as e:
            print(f"  評価エラー: {e}")
            evaluation = {"faithfulness": 0, "relevancy": 0, "completeness": 0, "reasoning": str(e)}

        for key in scores:
            if evaluation.get(key, 0) > 0:
                scores[key].append(evaluation[key])

        results.append({
            "id": q["id"],
            "question": q["question"],
            "category": q.get("category", ""),
            "expected_doc": q["expected_doc"],
            "ground_truth": q["ground_truth"],
            "answer": answer,
            "tool_calls": tool_calls,
            "evaluation": evaluation,
            "rag_time_seconds": round(rag_time, 2),
        })

        time.sleep(1)

    print("\n" + "=" * 70)
    print("## 評価サマリー")
    print(f"質問数: {len(questions)}")
    for key in scores:
        vals = scores[key]
        if vals:
            avg = sum(vals) / len(vals)
            print(f"  {key:15}: {avg:.2f} / 5.00  (min={min(vals)}, max={max(vals)}, n={len(vals)})")

    overall = []
    for key in scores:
        overall.extend(scores[key])
    if overall:
        print(f"  {'Overall':15}: {sum(overall)/len(overall):.2f} / 5.00")

    output_path = Path(args.output)
    output_path.write_text(json.dumps({
        "summary": {
            key: {
                "avg": round(sum(vals) / len(vals), 2) if vals else 0,
                "min": min(vals) if vals else 0,
                "max": max(vals) if vals else 0,
                "count": len(vals),
            }
            for key, vals in scores.items()
        },
        "results": results,
    }, ensure_ascii=False, indent=2))
    print(f"\n結果を {output_path} に保存しました。")


if __name__ == "__main__":
    main()
