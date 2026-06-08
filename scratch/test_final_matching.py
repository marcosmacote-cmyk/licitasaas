import sys
import asyncio
import json
from pathlib import Path

watcher_path = Path("/Users/marcosgomes/.gemini/antigravity/playground/ancient-copernicus/ai_service/bbmnet-watcher")
sys.path.append(str(watcher_path))

from main import BBMNetWatcher

async def main():
    # Instantiate the watcher
    watcher = BBMNetWatcher(token_only=True)
    
    # Authenticate and get ID token
    print("Authenticating...")
    session_dir = watcher_path / "session_data"
    tokens = json.loads((session_dir / "firebase_tokens.json").read_text())
    watcher.firebase.set_refresh_token(tokens.get("refresh_token"))
    id_token = await watcher.firebase.ensure_valid_token()
    print("Authentication successful.")
    
    # Test Pacajus
    print("\n--- Testing Pacajus ---")
    pacajus_info = {
        'title': 'Concorrência Eletrônica 010/2026 - PREFEITURA MUNICIPAL DE PACAJUS',
        'link': ''
    }
    pacajus_lote_ids = await watcher._discover_lote_ids(pacajus_info, id_token)
    print(f"Pacajus resolved Lote IDs: {pacajus_lote_ids}")
    assert 'x6I5xiLEFY0RvPE5zivR' in pacajus_lote_ids, "ERROR: Pacajus should resolve to x6I5xiLEFY0RvPE5zivR!"
    print("SUCCESS: Pacajus matches correctly!")
    
    # Test Baturité
    print("\n--- Testing Baturité ---")
    baturite_info = {
        'title': '17.03.01/2026 - Baturité',
        'link': ''
    }
    baturite_lote_ids = await watcher._discover_lote_ids(baturite_info, id_token)
    print(f"Baturité resolved Lote IDs: {baturite_lote_ids}")
    assert 'pH6RLvWag6iBhSJoaQaX' in baturite_lote_ids, "ERROR: Baturité should resolve to pH6RLvWag6iBhSJoaQaX!"
    print("SUCCESS: Baturité matches correctly!")

    await watcher.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
