import pandas as pd
import json
import argparse
import sys
import re
from datetime import datetime
import os

# Estratégia: 
# 1. Ler os Excels gigantes da CAIXA (SINAPI) ou SEINFRA
# 2. Limpar headers sujos e padronizar nomes de colunas
# 3. Gerar um arquivo JSON limpo
# 4. Um script Node/Prisma vai ler esse JSON e fazer a inserção segura no Banco.

def parse_sinapi(file_path):
    print(f"[SINAPI] Lendo arquivo: {file_path}")
    # Arquivos SINAPI geralmente tem um cabeçalho explicativo nas primeiras linhas. 
    # Tentamos ignorar as linhas em branco/texto e pegar a tabela real (header na linha 4 ou 5)
    
    try:
        # Pular linhas até achar o cabeçalho (CODIGO DA COMPOSICAO, etc)
        df = pd.read_excel(file_path, header=None)
        
        # Encontrar linha do header real
        header_idx = -1
        for i in range(min(20, len(df))):
            row_vals = [str(x).upper() for x in df.iloc[i].values]
            if any('CÓDIGO' in v or 'CODIGO' in v for v in row_vals):
                header_idx = i
                break
                
        if header_idx == -1:
            print("Erro: Não foi possível identificar o cabeçalho do SINAPI.")
            return None
            
        print(f"[SINAPI] Cabeçalho encontrado na linha {header_idx}")
        df = pd.read_excel(file_path, header=header_idx)
        
        # Renomear colunas para padrão interno LicitaSaaS
        col_mapping = {}
        for col in df.columns:
            col_u = str(col).upper()
            if 'CÓDIGO' in col_u or 'CODIGO DA COMPOSICAO' in col_u or 'CODIGO DO INSUMO' in col_u:
                col_mapping[col] = 'code'
            elif 'DESCRICAO' in col_u or 'DESCRIÇÃO' in col_u:
                col_mapping[col] = 'description'
            elif 'UNID' in col_u:
                col_mapping[col] = 'unit'
            elif 'PREÇO MEDIANO' in col_u or 'PRECO' in col_u or 'CUSTO' in col_u or 'VALOR' in col_u:
                col_mapping[col] = 'unitCost'
            elif 'TIPO' in col_u or 'CLASSE' in col_u:
                col_mapping[col] = 'type'
        
        df = df.rename(columns=col_mapping)
        
        # Manter apenas as mapeadas
        req_cols = ['code', 'description', 'unit', 'unitCost']
        for rc in req_cols:
            if rc not in df.columns:
                print(f"[ERRO] Coluna obrigatória ausente após mapeamento: {rc}")
                print(f"Colunas encontradas: {df.columns.tolist()}")
                return None
                
        # Tipo de insumo (se não vier no excel)
        if 'type' not in df.columns:
            df['type'] = 'MATERIAL' # Default

        df_final = df[req_cols + ['type']].dropna(subset=['code', 'description', 'unitCost'])
        
        # Conversão de tipos
        df_final['code'] = df_final['code'].astype(str).str.strip()
        df_final['description'] = df_final['description'].astype(str).str.strip()
        df_final['unit'] = df_final['unit'].astype(str).str.strip()
        
        # Converter unitCost para float (tratar vírgulas e pontos BR)
        if df_final['unitCost'].dtype == 'O':
            df_final['unitCost'] = df_final['unitCost'].str.replace('.', '', regex=False).str.replace(',', '.', regex=False)
        df_final['unitCost'] = pd.to_numeric(df_final['unitCost'], errors='coerce').fillna(0.0)

        # Converter para lista de dicts
        records = df_final.to_dict('records')
        print(f"[SINAPI] Sucesso! {len(records)} insumos extraídos.")
        return records
        
    except Exception as e:
        print(f"[ERRO SINAPI] {str(e)}")
        return None

def parse_seinfra(file_path):
    print(f"[SEINFRA] Lendo arquivo: {file_path}")
    # SEINFRA no Ceará costuma usar formatos PDF, mas quando XLS segue um padrão diferente.
    # Lógica bem similar, ajustando apenas o mapeamento.
    try:
        df = pd.read_excel(file_path, header=None)
        
        # Achar header (codigo, descriçao, unidade, valor_unit)
        header_idx = -1
        for i in range(min(20, len(df))):
            row_vals = [str(x).upper() for x in df.iloc[i].values]
            if any('CÓD' in v or 'COD' in v for v in row_vals) and any('VALOR' in v or 'CUSTO' in v for v in row_vals):
                header_idx = i
                break
                
        if header_idx == -1:
            print("Erro: Não foi possível identificar o cabeçalho do SEINFRA.")
            return None
            
        print(f"[SEINFRA] Cabeçalho encontrado na linha {header_idx}")
        df = pd.read_excel(file_path, header=header_idx)
        
        col_mapping = {}
        for col in df.columns:
            col_u = str(col).upper()
            if 'CÓD' in col_u or 'COD' in col_u:
                col_mapping[col] = 'code'
            elif 'DESCRI' in col_u:
                col_mapping[col] = 'description'
            elif 'UND' in col_u or 'UNID' in col_u:
                col_mapping[col] = 'unit'
            elif 'VALOR' in col_u or 'CUSTO' in col_u or 'PREÇO' in col_u:
                col_mapping[col] = 'unitCost'
            elif 'TIPO' in col_u:
                col_mapping[col] = 'type'
                
        df = df.rename(columns=col_mapping)
        req_cols = ['code', 'description', 'unit', 'unitCost']
        
        if 'type' not in df.columns:
            df['type'] = 'MATERIAL'

        df_final = df[req_cols + ['type']].dropna(subset=['code', 'description', 'unitCost'])
        
        df_final['code'] = df_final['code'].astype(str).str.strip()
        df_final['description'] = df_final['description'].astype(str).str.strip()
        df_final['unit'] = df_final['unit'].astype(str).str.strip()
        
        if df_final['unitCost'].dtype == 'O':
            df_final['unitCost'] = df_final['unitCost'].str.replace('.', '', regex=False).str.replace(',', '.', regex=False)
        df_final['unitCost'] = pd.to_numeric(df_final['unitCost'], errors='coerce').fillna(0.0)

        records = df_final.to_dict('records')
        print(f"[SEINFRA] Sucesso! {len(records)} insumos extraídos.")
        return records

    except Exception as e:
        print(f"[ERRO SEINFRA] {str(e)}")
        return None

def main():
    parser = argparse.ArgumentParser(description="ETL de Bases Oficiais de Engenharia (SINAPI/SEINFRA)")
    parser.add_argument("--source", type=str, required=True, choices=["SINAPI", "SEINFRA"], help="Fonte da Tabela (SINAPI ou SEINFRA)")
    parser.add_argument("--uf", type=str, required=True, help="UF da tabela (ex: CE)")
    parser.add_argument("--date", type=str, required=True, help="Data de Referência (YYYY-MM)")
    parser.add_argument("--desonerado", type=bool, default=False, help="Tabela é desonerada?")
    parser.add_argument("--file", type=str, required=True, help="Caminho do arquivo Excel/CSV")
    parser.add_argument("--output", type=str, default="normalized_base.json", help="Arquivo de saída JSON")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.file):
        print(f"Erro: Arquivo '{args.file}' não encontrado.")
        sys.exit(1)
        
    records = []
    if args.source == "SINAPI":
        records = parse_sinapi(args.file)
    elif args.source == "SEINFRA":
        records = parse_seinfra(args.file)
        
    if not records:
        print("Falha na extração. O JSON não foi gerado.")
        sys.exit(1)
        
    # Estruturar o JSON final de saída (Metadados da Database + Itens)
    payload = {
        "metadata": {
            "sourceName": args.source,
            "stateUf": args.uf,
            "referenceDate": f"{args.date}-01T00:00:00.000Z", # ISO8601 for Prisma
            "desonerado": args.desonerado
        },
        "items": records
    }
    
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        
    print(f"✅ ETL Concluído com Sucesso! {len(records)} insumos normalizados salvos em {args.output}")
    print(f"Próximo passo: Rodar o script Node (seed_db.ts) passando '{args.output}' para inserir via Prisma.")

if __name__ == "__main__":
    main()
