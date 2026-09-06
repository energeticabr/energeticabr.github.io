# Gerar o Atalho ENERGÉTICO

A fonte usa apenas uma pergunta de importação para a credencial. Nenhuma credencial real deve ser incluída no código ou no arquivo publicado.

Use Cherri 2.3.0 com UUIDs aleatórios (o comportamento padrão):

```sh
./cherri ENERGÉTICO.cherri --debug --hubsign --share=anyone --no-ansi
```

Não use `--derive-uuids` nesta versão do compilador: ele gera o mesmo `GroupingIdentifier` para o `if` e o `repeat` aninhados, além de UUIDs de fechamento duplicados. Confirme no plist gerado que os dois grupos são distintos e que cada início tem seu fechamento correspondente.

Sem entrada compartilhada, o Atalho deve apenas abrir a URL do chatbot. Com entrada, deve repetir o upload binário para cada arquivo e abrir a URL ao terminar. Nenhuma ação deve solicitar uma foto para iniciar.

Preserve o nome de saída `ENERGÉTICO.shortcut` ao copiá-lo para `pwa/downloads/`. Após assinar, confirme o prefixo binário `AEA1`, calcule o SHA-256 e atualize a versão do link em `src/web/install-view.js` e seu teste. A rota `/api/install-shortcut` no Caddy fornece o MIME da Apple e o nome UTF-8 para importação.

O ícone de uso diário é a PWA instalada pelo Safari com o mascote. O Atalho fica na Folha de Compartilhamento; sua ação de abrir URL usa o navegador.
