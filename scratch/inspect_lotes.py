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
    
    import httpx
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
                    'edital': parsed.get('Edital', parsed.get('edital', {})),
                    'numero': parsed.get('Numero', parsed.get('numero', '')),
                    'uniqueId': parsed.get('UniqueId', parsed.get('uniqueId', '')),
                    'parsed_all': parsed
                })
        return lotes

async def main():
    firebase = FirebaseAuth()
    session_dir = watcher_path / "session_data"
    tokens = json.loads((session_dir / "firebase_tokens.json").read_text())
    firebase.set_refresh_token(tokens.get("refresh_token"))
    id_token = await firebase.refresh_id_token()
    
    # Try different fields and values for Baturite
    search_queries = [
        ("Edital.OrgaoPromotor.Nome", "Baturité"),
        ("Edital.OrgaoPromotor.Nome", "Baturite"),
        ("Edital.UnidadeCompradora.Nome", "Baturité"),
        ("Edital.UnidadeCompradora.Nome", "Baturite"),
    ]
    
    for field, val in search_queries:
        print(f"Querying {field} = '{val}'...")
        lotes = await query_lotes_by_field(id_token, field, val)
        print(f"Found {len(lotes)} lotes.")
        for l in lotes:
            edital = l.get('edital', {})
            print(f"  Lote ID: {l['id']}, NumeroEdital: {edital.get('NumeroEdital')}, NumeroProcesso: {edital.get('NumeroProcesso')}, Objeto: {str(edital.get('Objeto'))[:100]}...")
            
    await firebase.close()

if __name__ == "__main__":
    asyncio.run(main())
