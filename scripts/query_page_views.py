"""Read the page_views table using only the Supabase anon key.

Reads SUPABASE_URL and SUPABASE_ANON_KEY from the repository's
config.public.json. This script performs read-only queries.
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
            client.table("page_views")
            .select("id", count="exact", head=True)
            .execute()
        )
        print(f"page_views rows visible to anon: {count_result.count or 0}")

        rows_result = (
            client.table("page_views")
            .select("id, visited_at, page_url")
            .order("visited_at", desc=True)
            .limit(10)
            .execute()
        )
        print("Most recent page views:")
        for row in rows_result.data or []:
            print(row)
    except Exception as exc:
        print(f"Could not query page_views with the anon key: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
