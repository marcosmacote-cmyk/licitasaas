import sys
import asyncio
import json
from pathlib import Path

watcher_path = Path("/Users/marcosgomes/.gemini/antigravity/playground/ancient-copernicus/ai_service/bbmnet-watcher")
sys.path.append(str(watcher_path))

from auth.firebase_auth import FirebaseAuth
from monitor.firestore_reader import FirestoreReader, FIRESTORE_BASE
import httpx

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
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=query, headers={'Authorization': f'Bearer {id_token}'})
        if resp.status_code != 200:
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
    
    # 1. Search by 010/2026-CP
    for field in ["Edital.NumeroProcesso", "Edital.NumeroEdital", "NumeroEdital", "NumeroProcesso", "numero", "Numero"]:
        lotes = await query_lotes_by_field(id_token, field, "010/2026-CP")
        print(f"Query {field} == '010/2026-CP': found {len(lotes)} lotes.")
        for l in lotes:
            parsed = l['parsed_all']
            edital = parsed.get('Edital', parsed.get('edital', {}))
            print(f"  Lote ID: {l['id']}, Orgao: {edital.get('OrgaoPromotor', {}).get('Nome')}, Processo: {edital.get('NumeroProcesso')}, Edital: {edital.get('NumeroEdital')}")

    # 2. Search by 010/2026 (without -CP) but check for Pacajus
    lotes = await query_lotes_by_field(id_token, "Edital.NumeroProcesso", "010/2026")
    print(f"\nChecking 010/2026 lotes for Pacajus...")
    for l in lotes:
        parsed = l['parsed_all']
        edital = parsed.get('Edital', parsed.get('edital', {}))
        orgao = edital.get('OrgaoPromotor', {}).get('Nome', '')
        if "pacajus" in orgao.lower():
            print(f"  Found Pacajus under 010/2026: Lote ID {l['id']}, Orgao: {orgao}")

    # 3. Check for Baturité edital 17.03.01/2026
    lotes = await query_lotes_by_field(id_token, "Edital.NumeroProcesso", "17.03.01/2026")
    print(f"\nQuery Edital.NumeroProcesso == '17.03.01/2026': found {len(lotes)} lotes.")
    for l in lotes:
        parsed = l['parsed_all']
        edital = parsed.get('Edital', parsed.get('edital', {}))
        print(f"  Lote ID: {l['id']}, Orgao: {edital.get('OrgaoPromotor', {}).get('Nome')}, Processo: {edital.get('NumeroProcesso')}, Edital: {edital.get('NumeroEdital')}")
            
    await firebase.close()

if __name__ == "__main__":
    asyncio.run(main())
