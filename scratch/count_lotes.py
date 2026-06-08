import sys
import asyncio
import json
from pathlib import Path

watcher_path = Path("/Users/marcosgomes/.gemini/antigravity/playground/ancient-copernicus/ai_service/bbmnet-watcher")
sys.path.append(str(watcher_path))

from auth.firebase_auth import FirebaseAuth
from monitor.firestore_reader import FirestoreReader, FIRESTORE_BASE

async def main():
    firebase = FirebaseAuth()
    session_dir = watcher_path / "session_data"
    tokens = json.loads((session_dir / "firebase_tokens.json").read_text())
    firebase.set_refresh_token(tokens.get("refresh_token"))
    id_token = await firebase.refresh_id_token()
    
    import httpx
    client = httpx.AsyncClient(timeout=30.0)
    
    total = 0
    next_page_token = None
    print("Paging through all lotes...")
    while True:
        url = f"{FIRESTORE_BASE}/lotes?pageSize=300"
        if next_page_token:
            url += f"&pageToken={next_page_token}"
            
        resp = await client.get(url, headers={'Authorization': f'Bearer {id_token}'})
        if resp.status_code != 200:
            print(f"Error {resp.status_code}: {resp.text}")
            break
            
        data = resp.json()
        docs = data.get('documents', [])
        total += len(docs)
        print(f"Fetched {len(docs)} documents (cumulative total: {total})")
        
        next_page_token = data.get('nextPageToken')
        if not next_page_token:
            break
            
    print(f"\nFinished. Total lotes in database: {total}")
    await client.aclose()
    await firebase.close()

if __name__ == "__main__":
    asyncio.run(main())
