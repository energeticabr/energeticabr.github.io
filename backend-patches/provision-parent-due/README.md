# Proximo vencimento em aberto do descritivo

O vencimento previsto do descritivo e o menor dia civil entre as provisoes vinculadas que ainda nao estejam comprovadamente pagas. Datas vencidas continuam restritivas; agendamento futuro sozinho nao quita uma provisao. Depois de cada baixa, o pai passa ao proximo vencimento em aberto. Quando todos estiverem pagos, a data prevista historica permanece e a data efetiva segue as regras existentes de quitacao integral.

Criacao, acrescimo de linhas, baixa individual, baixa parcial e edicao/troca de vinculo na galeria seguem a mesma regra. A atualizacao derivada escreve somente no pai e preserva os vencimentos individuais dos filhos. Leituras incompletas, datas desconhecidas ou alteracoes concorrentes exigem nova conferencia.

O pacote de backend fixa quatro fontes existentes, sete entradas e o mirror somente leitura. Fontes completas e `source-files.tar` permanecem fora deste repositorio publico. O instalador reutiliza os contratos de bytes imutaveis, hashes, CAS, gate/drain, lock, backup, fsync, saude e rollback.

Testes funcionais em `tests/` usam `ENERGETICA_BACKEND_TEST_ROOT` com fontes privadas e destinos sinteticos. Os contratos da raiz executam em CI sem acesso a dados financeiros:

```sh
python -B -m unittest discover -s backend-patches/provision-parent-due -v
```

O backend e publicado no servidor comum. As alteracoes do portal importadas pelo aplicativo tambem requerem publicar web/Windows, Android interno e iOS TestFlight para a mesma revisao.
