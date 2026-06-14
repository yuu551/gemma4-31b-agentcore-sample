"""S3にドキュメントをアップロードし、Knowledge Baseのデータソースを同期する。

Usage:
    python seed.py --bucket <docs-bucket-name> --kb-id <knowledge-base-id> [--region us-east-1]
"""

import argparse
import json
import time
from pathlib import Path

import boto3


def main():
    parser = argparse.ArgumentParser(description="Upload docs to S3 and sync Knowledge Base")
    parser.add_argument("--bucket", required=True, help="S3 bucket name for documents")
    parser.add_argument("--kb-id", required=True, help="Knowledge Base ID")
    parser.add_argument("--region", default="us-east-1", help="AWS region")
    args = parser.parse_args()

    docs_path = Path(__file__).parent / "documents.json"
    docs = json.loads(docs_path.read_text())

    s3 = boto3.client("s3", region_name=args.region)
    bedrock_agent = boto3.client("bedrock-agent", region_name=args.region)

    print(f"Uploading {len(docs)} documents to s3://{args.bucket}/...")
    for doc in docs:
        metadata = json.dumps({
            "metadataAttributes": {
                "category": {"stringValue": doc["category"], "type": "STRING"},
                "title": {"stringValue": doc["title"], "type": "STRING"},
            }
        })

        s3.put_object(
            Bucket=args.bucket,
            Key=f"docs/{doc['key']}.txt",
            Body=doc["text"].encode("utf-8"),
            ContentType="text/plain; charset=utf-8",
        )
        s3.put_object(
            Bucket=args.bucket,
            Key=f"docs/{doc['key']}.txt.metadata.json",
            Body=metadata.encode("utf-8"),
            ContentType="application/json",
        )
        print(f"  Uploaded: {doc['key']} ({doc['category']})")

    print(f"\nStarting Knowledge Base sync...")
    ds_response = bedrock_agent.list_data_sources(knowledgeBaseId=args.kb_id)
    data_source_id = ds_response["dataSourceSummaries"][0]["dataSourceId"]

    ingestion = bedrock_agent.start_ingestion_job(
        knowledgeBaseId=args.kb_id,
        dataSourceId=data_source_id,
    )
    job_id = ingestion["ingestionJob"]["ingestionJobId"]
    print(f"  Ingestion job started: {job_id}")

    while True:
        status = bedrock_agent.get_ingestion_job(
            knowledgeBaseId=args.kb_id,
            dataSourceId=data_source_id,
            ingestionJobId=job_id,
        )
        state = status["ingestionJob"]["status"]
        print(f"  Status: {state}")
        if state in ("COMPLETE", "FAILED", "STOPPED"):
            break
        time.sleep(5)

    if state == "COMPLETE":
        stats = status["ingestionJob"].get("statistics", {})
        print(f"\nDone! {stats.get('numberOfDocumentsScanned', '?')} docs scanned, "
              f"{stats.get('numberOfNewDocumentsIndexed', '?')} indexed")
    else:
        print(f"\nIngestion failed: {status['ingestionJob'].get('failureReasons', 'unknown')}")


if __name__ == "__main__":
    main()
