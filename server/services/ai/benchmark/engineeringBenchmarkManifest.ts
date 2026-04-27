export const engineeringManifest = {
  "version": "1.0.0",
  "description": "Benchmark de extração de planilha orçamentária de engenharia — Casos reais do PNCP para validação do pipeline Page Targeting + Gemini",
  "created_at": "2026-04-27",
  "updated_at": "2026-04-27",
  "pipeline_version": "v2.0.0-page-targeting",
  "scoring": {
    "item_count_accuracy": 20,
    "code_coverage": 25,
    "total_reconciliation": 25,
    "hierarchy_integrity": 15,
    "no_duplicates": 10,
    "no_ghosts": 5
  },
  "cases": [
    {
      "id": "eng-001",
      "name": "Escola Tempo Integral Itapipoca — SEINFRA-CE",
      "tipo_objeto": "obra_engenharia",
      "complexity": "alta",
      "description": "Concorrência 26.06.04-CE — Construção de escola de ensino em tempo integral. Planilha SEINFRA com ~120 itens, BDI 25%. PDF grande com planilha embutida no Projeto Básico.",
      "pncp_ref": {
        "cnpj": "07565879000139",
        "ano": "2026",
        "seq": "2"
      },
      "source": {
        "estimatedValue": 18561152.98,
        "portal": "PNCP",
        "sessionDate": "2026-05-21T14:00:00"
      },
      "expected": {
        "min_items": 80,
        "max_items": 200,
        "min_etapas": 5,
        "min_composicoes": 40,
        "primary_base": "SEINFRA",
        "code_coverage_min_pct": 60,
        "bdi_range": { "min": 0.20, "max": 0.35 },
        "total_estimated": 18561152.98,
        "total_tolerance_pct": 30,
        "key_etapas": [
          "SERVIÇOS PRELIMINARES",
          "INFRAESTRUTURA",
          "SUPERESTRUTURA",
          "ALVENARIA",
          "COBERTURA",
          "INSTALAÇÕES ELÉTRICAS",
          "INSTALAÇÕES HIDRÁULICAS",
          "REVESTIMENTO",
          "PINTURA",
          "ESQUADRIAS"
        ],
        "key_codes": [
          "C0054",
          "C2591",
          "C3697",
          "C1379",
          "C3099"
        ]
      }
    },
    {
      "id": "eng-002",
      "name": "Pavimentação Asfáltica — SOP Ceará",
      "tipo_objeto": "obra_engenharia",
      "complexity": "alta",
      "description": "Concorrência SOP — Obra de pavimentação asfáltica com drenagem. Planilha SINAPI + SICRO com ~150 itens.",
      "pncp_ref": {
        "cnpj": "07954480000179",
        "ano": "2026",
        "seq": "6850"
      },
      "source": {
        "estimatedValue": 0,
        "portal": "Compras.gov.br",
        "sessionDate": null
      },
      "expected": {
        "min_items": 50,
        "max_items": 250,
        "min_etapas": 4,
        "min_composicoes": 30,
        "primary_base": "SINAPI",
        "code_coverage_min_pct": 50,
        "bdi_range": { "min": 0.20, "max": 0.35 },
        "total_estimated": 0,
        "total_tolerance_pct": 50,
        "key_etapas": [
          "TERRAPLENAGEM",
          "PAVIMENTAÇÃO",
          "DRENAGEM",
          "SINALIZAÇÃO"
        ],
        "key_codes": []
      }
    },
    {
      "id": "eng-003",
      "name": "UBS Jaguaruana — Construção",
      "tipo_objeto": "obra_engenharia",
      "complexity": "alta",
      "description": "Concorrência PMJ — Construção de Unidade Básica de Saúde. Planilha SEINFRA com ~100 itens.",
      "pncp_ref": {
        "cnpj": "07615750000117",
        "ano": "2026",
        "seq": "33"
      },
      "source": {
        "estimatedValue": 0,
        "portal": "Compras.gov.br",
        "sessionDate": null
      },
      "expected": {
        "min_items": 50,
        "max_items": 200,
        "min_etapas": 5,
        "min_composicoes": 30,
        "primary_base": "SEINFRA",
        "code_coverage_min_pct": 50,
        "bdi_range": { "min": 0.20, "max": 0.35 },
        "total_estimated": 0,
        "total_tolerance_pct": 50,
        "key_etapas": [
          "SERVIÇOS PRELIMINARES",
          "INFRAESTRUTURA",
          "SUPERESTRUTURA",
          "INSTALAÇÕES"
        ],
        "key_codes": []
      }
    },
    {
      "id": "eng-004",
      "name": "Construção Baturité — BBMNET",
      "tipo_objeto": "obra_engenharia",
      "complexity": "alta",
      "description": "Concorrência Eletrônica Baturité — Construção de edificação pública via BBMNET.",
      "pncp_ref": {
        "cnpj": "07387343000108",
        "ano": "2026",
        "seq": "35"
      },
      "source": {
        "estimatedValue": 0,
        "portal": "BBMNET",
        "sessionDate": null
      },
      "expected": {
        "min_items": 40,
        "max_items": 200,
        "min_etapas": 4,
        "min_composicoes": 25,
        "primary_base": "SEINFRA",
        "code_coverage_min_pct": 40,
        "bdi_range": { "min": 0.20, "max": 0.35 },
        "total_estimated": 0,
        "total_tolerance_pct": 50,
        "key_etapas": [
          "SERVIÇOS PRELIMINARES",
          "INFRAESTRUTURA"
        ],
        "key_codes": []
      }
    },
    {
      "id": "eng-005",
      "name": "Apuiarés — Licita Mais Brasil",
      "tipo_objeto": "obra_engenharia",
      "complexity": "alta",
      "description": "Concorrência Apuiarés — Obra de engenharia via Licita Mais Brasil.",
      "pncp_ref": {
        "cnpj": "07438468000101",
        "ano": "2026",
        "seq": "11"
      },
      "source": {
        "estimatedValue": 0,
        "portal": "Licita Mais Brasil",
        "sessionDate": null
      },
      "expected": {
        "min_items": 40,
        "max_items": 200,
        "min_etapas": 4,
        "min_composicoes": 25,
        "primary_base": "SEINFRA",
        "code_coverage_min_pct": 40,
        "bdi_range": { "min": 0.20, "max": 0.35 },
        "total_estimated": 0,
        "total_tolerance_pct": 50,
        "key_etapas": [
          "SERVIÇOS PRELIMINARES"
        ],
        "key_codes": []
      }
    }
  ]
}
