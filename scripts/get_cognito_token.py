#!/usr/bin/env python3
"""Cognito のアクセストークンを取得するローカル検証用スクリプト。

Usage:
    npm run auth:token -- --username user@example.com
    COGNITO_USERNAME=user@example.com COGNITO_PASSWORD='...' npm run auth:token
    npm run auth:token -- --username user@example.com --json
"""

import argparse
import getpass
import json
import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError


def load_auth_config(outputs_path: Path) -> dict:
    outputs = json.loads(outputs_path.read_text())
    auth = outputs.get("auth") or {}
    region = auth.get("aws_region")
    client_id = auth.get("user_pool_client_id")
    user_pool_id = auth.get("user_pool_id")

    if not region or not client_id:
        raise SystemExit(f"{outputs_path} に auth.aws_region / auth.user_pool_client_id が見つかりません。")

    return {
        "region": region,
        "client_id": client_id,
        "user_pool_id": user_pool_id,
    }


def get_token(region: str, client_id: str, username: str, password: str) -> dict:
    client = boto3.client("cognito-idp", region_name=region)
    try:
        response = client.initiate_auth(
            ClientId=client_id,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={
                "USERNAME": username,
                "PASSWORD": password,
            },
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "ClientError")
        message = e.response.get("Error", {}).get("Message", str(e))
        raise SystemExit(f"Cognito 認証に失敗しました: {code}: {message}") from e

    challenge = response.get("ChallengeName")
    if challenge:
        raise SystemExit(f"追加チャレンジが必要です: {challenge}")

    result = response.get("AuthenticationResult") or {}
    if not result.get("AccessToken"):
        raise SystemExit("AuthenticationResult.AccessToken が返りませんでした。")

    return result


def main():
    parser = argparse.ArgumentParser(description="Get a Cognito access token for local scripts.")
    parser.add_argument("--outputs", default="amplify_outputs.json", help="Path to amplify_outputs.json")
    parser.add_argument("--username", default=os.environ.get("COGNITO_USERNAME"))
    parser.add_argument("--password", default=os.environ.get("COGNITO_PASSWORD"))
    parser.add_argument("--json", action="store_true", help="Print the full AuthenticationResult as JSON.")
    args = parser.parse_args()

    if not args.username:
        raise SystemExit("--username または COGNITO_USERNAME を指定してください。")

    password = args.password or getpass.getpass("Cognito password: ")
    config = load_auth_config(Path(args.outputs))
    result = get_token(config["region"], config["client_id"], args.username, password)

    if args.json:
        print(json.dumps({
            "userPoolId": config["user_pool_id"],
            "clientId": config["client_id"],
            "region": config["region"],
            "authenticationResult": result,
        }, ensure_ascii=False, indent=2))
        return

    print(result["AccessToken"])


if __name__ == "__main__":
    main()
