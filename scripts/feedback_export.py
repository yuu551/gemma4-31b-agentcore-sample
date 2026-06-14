#!/usr/bin/env python3
"""フィードバックデータを CSV にエクスポートする。

Usage:
    uv run --with boto3 python scripts/feedback_export.py --table <TABLE_NAME>
    uv run --with boto3 python scripts/feedback_export.py --table <TABLE_NAME> -o feedback.csv
"""

import argparse
import csv
import os
import sys

import boto3

COLUMNS = [
    "createdAt",
    "sessionId",
    "messageId",
    "rating",
    "comment",
    "category",
    "question",
    "answerPreview",
    "toolCallCount",
    "userId",
    "sourceIp",
]


def scan_all(table_name: str):
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


def extract(item, key):
    raw = item.get(key)
    if not raw:
        return ""
    if "S" in raw:
        return raw["S"]
    if "N" in raw:
        return raw["N"]
    return ""


def main():
    parser = argparse.ArgumentParser(description="Export feedback to CSV")
    parser.add_argument("--table", default=os.environ.get("FEEDBACK_TABLE_NAME"))
    parser.add_argument("-o", "--output", default=None, help="Output CSV file (default: stdout)")
    args = parser.parse_args()

    if not args.table:
        raise SystemExit("Set FEEDBACK_TABLE_NAME or pass --table.")

    items = scan_all(args.table)
    rows = sorted(
        [{ col: extract(item, col) for col in COLUMNS } for item in items],
        key=lambda r: r["createdAt"],
    )

    out = open(args.output, "w", newline="", encoding="utf-8") if args.output else sys.stdout
    writer = csv.DictWriter(out, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)

    if args.output:
        out.close()
        print(f"{len(rows)} rows exported to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
