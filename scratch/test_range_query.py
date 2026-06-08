import sys
import asyncio
import json
from pathlib import Path

watcher_path = Path("/Users/marcosgomes/.gemini/antigravity/playground/ancient-copernicus/ai_service/bbmnet-watcher")
sys.path.append(str(watcher_path))

from auth.firebase_auth import FirebaseAuth
from monitor.firestore_reader import FirestoreReader, FIRESTORE_BASE
import httpx

async def query_lotes_by_prefix(id_token: str, field_path: str, prefix: str):
    url = f"{FIRESTORE_BASE}:runQuery"
    
    # Range query for prefix matching
    query = {
        "structuredQuery": {
            "from": [{"collectionId": "lotes"}],
            "where": {
                "compositeFilter": {
                    "op": "AND",
                    "filters": [
                        {
                            "fieldFilter": {
                                "field": {"fieldPath": field_path},
                                "op": "GREATER_THAN_OR_EQUAL",
                                "value": {"stringValue": prefix}
                            }
                        },
                        {
                            "fieldFilter": {
                                "field": {"fieldPath": field_path},
                                "op": "LESS_THAN_OR_EQUAL",
                                "value": {"stringValue": prefix + "\uf8ff"}
                            }
                        }
                    ]
                }
            }
        }
    }
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=query, headers={'Authorization': f'Bearer {id_token}'})
        if resp.status_code != 200:
            print(f"Error {resp.status_code}: {resp.text}")
            return []
        
        results = resp.json()
        lotes = []
        for item in results:
            if "document" in item:
                doc = item["document"]
                fields = doc.get('fields', {})
                lote_id = doc.get('name', '').split('/')[-1]
                parsed = {}
                for k, v in fields.items():
                    parsed[k] = FirestoreReader._parse_value(v)
                lotes.append({
                    'id': lote_id,
                    'parsed_all': parsed
                })
        return lotes

async def main():
    firebase = FirebaseAuth()
    session_dir = watcher_path / "session_data"
    tokens = json.loads((session_dir / "firebase_tokens.json").read_text())
    firebase.set_refresh_token(tokens.get("refresh_token"))
    id_token = await firebase.refresh_id_token()
    
    # Query for 010/2026 range on Edital.NumeroProcesso
    lotes = await query_lotes_by_prefix(id_token, "Edital.NumeroProcesso", "010/2026")
    print(f"Prefix query '010/2026' on Edital.NumeroProcesso returned {len(lotes)} lotes.")
    for l in lotes:
        parsed = l['parsed_all']
        edital = parsed.get('Edital', parsed.get('edital', {}))
        orgao = edital.get('OrgaoPromotor', {}).get('Nome', '')
        print(f"  Lote ID: {l['id']}, Orgao: {orgao}, Processo: {edital.get('NumeroProcesso')}")
        
    await firebase.close()

if __name__ == "__main__":
    asyncio.run(main())
