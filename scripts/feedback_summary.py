#!/usr/bin/env python3
import argparse
import json
import os
from collections import Counter

import boto3


def scan_table(table_name: str):
    client = boto3.client("dynamodb")
    items = []
    last_key = None

    while True:
        kwargs = {"TableName": table_name}
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key

        response = client.scan(**kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return items


def value(item, key, default=""):
    raw = item.get(key)
    if not raw:
        return default
    if "S" in raw:
        return raw["S"]
    if "N" in raw:
        return int(raw["N"])
    return default


def summarize(items):
    ratings = Counter(value(item, "rating", "unknown") for item in items)
    categories = Counter(value(item, "category", "uncategorized") or "uncategorized" for item in items)
    tool_usage = Counter("with_tool" if value(item, "toolCallCount", 0) else "without_tool" for item in items)
    comments = [
        {
            "createdAt": value(item, "createdAt"),
            "rating": value(item, "rating"),
            "category": value(item, "category"),
            "question": value(item, "question"),
            "comment": value(item, "comment"),
        }
        for item in items
        if value(item, "comment")
    ]

    return {
        "total": len(items),
        "ratings": dict(ratings),
        "categories": dict(categories),
        "toolUsage": dict(tool_usage),
        "comments": comments,
    }


def main():
    parser = argparse.ArgumentParser(description="Summarize feedback records from DynamoDB.")
    parser.add_argument("--table", default=os.environ.get("FEEDBACK_TABLE_NAME"))
    parser.add_argument("--json", action="store_true", help="Print raw JSON summary.")
    args = parser.parse_args()

    if not args.table:
        raise SystemExit("Set FEEDBACK_TABLE_NAME or pass --table.")

    summary = summarize(scan_table(args.table))
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    print(f"Total: {summary['total']}")
    print(f"Ratings: {summary['ratings']}")
    print(f"Categories: {summary['categories']}")
    print(f"Tool usage: {summary['toolUsage']}")
    if summary["comments"]:
        print("\nComments")
        for comment in summary["comments"]:
            print(
                f"- [{comment['createdAt']}] {comment['rating']} "
                f"{comment['category']}: {comment['comment']}"
            )
            if comment["question"]:
                print(f"  Q: {comment['question']}")


if __name__ == "__main__":
    main()
