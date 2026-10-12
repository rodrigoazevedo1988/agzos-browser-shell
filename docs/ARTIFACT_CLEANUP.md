# Limpeza de browser-artifacts

`build-all.sh` monta os 6 instaladores do Agzos Browser numa pasta temporária
`/var/www/agzosagency/browser-artifacts-v<versao-sem-ponto>` (~1,2 GB) e o
`release-browser.sh` **copia** esses arquivos para `agzosagency/browser/vX.Y.Z`,
que é o que o nginx serve em `agzosagency.com.br/browser/`.

Até 2026-10-05 nada removia a pasta de build: 44 builds acumularam 47 GB em
`/var/www/agzosagency/`, a ~7 GB/dia no ritmo atual.

## O que é seguro apagar

Qualquer `browser-artifacts-v*`. São binários intermediários, sem código-fonte,
regeneráveis com `bash scripts/build-all.sh`. **Não** afeta:

- `agzosagency/browser/vX.Y.Z` — as versões publicadas (o nginx serve essas)
- `agzosagency/browser/latest.json` — o feed do auto-update
- o app instalado, que busca em `https://agzosagency.com.br/browser/latest.json`

## Automático

`build-all.sh` agora tem `KEEP_ARTIFACTS` (padrão 2) e chama `prune_artifacts`
**depois** do release, só se ele deu certo — se o build falhar, os artefatos
ficam para depurar em vez de sumirem junto com a causa.

```sh
KEEP_ARTIFACTS=5 bash scripts/build-all.sh   # mantém 5 em vez de 2
```

## Manual

```sh
cd /var/www/agzosagency
ls -dt browser-artifacts-* | tail -n +3 | xargs -r rm -rf
```

Antes de apagar em massa, confira que o nome casa com o padrão — o `prune_artifacts`
do script já faz essa checagem internamente.
