"""Read the sentence_embeddings table using only the Supabase anon key.

Reads SUPABASE_URL and SUPABASE_ANON_KEY from the repository's
config.public.json.
The project's current RLS policy grants SELECT to authenticated users only,
so an unauthenticated anon-key request is expected to be denied or return no
rows. This script uses only the public config and anon key.
"""

import json
import sys
from pathlib import Path

from supabase import create_client


def main() -> int:
    config_path = Path(__file__).resolve().parent.parent / "config.public.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Could not load {config_path.name}: {exc}", file=sys.stderr)
        return 2

    url = config.get("SUPABASE_URL")
    anon_key = config.get("SUPABASE_ANON_KEY")
    if not url or not anon_key:
        print(
            f"{config_path.name} must define SUPABASE_URL and SUPABASE_ANON_KEY.",
            file=sys.stderr,
        )
        return 2

    # Deliberately use the anon key only; do not substitute a service role key.
    client = create_client(url, anon_key)

    try:
        count_result = (
            client.table("sentence_embeddings")
            .select("id", count="exact", head=True)
            .execute()
        )
        print(f"sentence_embeddings rows visible to anon: {count_result.count or 0}")

        rows_result = (
            client.table("sentence_embeddings")
            .select("id, talk_id, title, speaker, sentence_num, text")
            .limit(5)
            .execute()
        )
        print("Sample sentence embeddings visible to anon:")
        for row in rows_result.data or []:
            print(row)

        if not rows_result.data:
            print(
                "No rows were returned. With the current project policy, "
                "the anon role is not allowed to read this table; sign in "
                "with an authenticated user or change the RLS policy if "
                "public reads are intended."
            )
    except Exception as exc:
        print(
            "Could not query sentence_embeddings with the anon key. "
            "This is expected when RLS permits SELECT only for authenticated users. "
            f"Details: {exc}",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
