import sys
import asyncio
import json
from pathlib import Path

watcher_path = Path("/Users/marcosgomes/.gemini/antigravity/playground/ancient-copernicus/ai_service/bbmnet-watcher")
sys.path.append(str(watcher_path))

from auth.firebase_auth import FirebaseAuth
from monitor.firestore_reader import FirestoreReader, FIRESTORE_BASE

async def query_lotes_by_field(id_token: str, field_path: str, value: str):
    url = f"{FIRESTORE_BASE}:runQuery"
    query = {
        "structuredQuery": {
            "from": [{"collectionId": "lotes"}],
            "where": {
                "fieldFilter": {
                    "field": {"fieldPath": field_path},
                    "op": "EQUAL",
                    "value": {"stringValue": value}
                }
            }
        }
    }
    
    async with httpx_client() as client:
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
                # Simple parser
                for k, v in fields.items():
                    # extract stringValue or mapValue etc.
                    parsed[k] = FirestoreReader._parse_value(v)
                
                lotes.append({
                    'id': lote_id,
                    'edital': parsed.get('Edital', parsed.get('edital', {})),
                    'numero': parsed.get('Numero', parsed.get('numero', '')),
                    'uniqueId': parsed.get('UniqueId', parsed.get('uniqueId', '')),
                    'parsed_all': parsed
                })
        return lotes

def httpx_client():
    import httpx
    return httpx.AsyncClient(timeout=30.0)

async def main():
    firebase = FirebaseAuth()
    session_dir = watcher_path / "session_data"
    tokens = json.loads((session_dir / "firebase_tokens.json").read_text())
    firebase.set_refresh_token(tokens.get("refresh_token"))
    id_token = await firebase.refresh_id_token()
    
    # Try querying by Edital.NumeroEdital
    print("Querying by Edital.NumeroEdital = '010/2026'...")
    lotes = await query_lotes_by_field(id_token, "Edital.NumeroEdital", "010/2026")
    print(f"Found {len(lotes)} lotes.")
    for l in lotes:
        edital = l.get('edital', {})
        op_name = edital.get('OrgaoPromotor', {}).get('Nome')
        print(f"  Lote ID: {l['id']}, NumeroEdital: {edital.get('NumeroEdital')}, Organ: {op_name}")
        
    # Try querying by Edital.NumeroProcesso
    print("\nQuerying by Edital.NumeroProcesso = '010/2026'...")
    lotes = await query_lotes_by_field(id_token, "Edital.NumeroProcesso", "010/2026")
    print(f"Found {len(lotes)} lotes.")
    for l in lotes:
        edital = l.get('edital', {})
        op_name = edital.get('OrgaoPromotor', {}).get('Nome')
        print(f"  Lote ID: {l['id']}, NumeroProcesso: {edital.get('NumeroProcesso')}, Organ: {op_name}")

    # Try querying by uniqueId
    print("\nQuerying by uniqueId = '3069536c-9f39-4b26-b7ee-2f91304802f2'...")
    lotes = await query_lotes_by_field(id_token, "uniqueId", "3069536c-9f39-4b26-b7ee-2f91304802f2")
    print(f"Found {len(lotes)} lotes.")
    for l in lotes:
        edital = l.get('edital', {})
        op_name = edital.get('OrgaoPromotor', {}).get('Nome')
        print(f"  Lote ID: {l['id']}, UniqueId: {l.get('uniqueId')}, Organ: {op_name}")
        
    await firebase.close()

if __name__ == "__main__":
    asyncio.run(main())
