# Swile no Energético

**Recursos Humanos → Swile** consulta os colaboradores e grupos da Corporate Gateway API, verifica a disponibilidade de Multibenefícios (`v13`) e informa o estado do cartão físico quando a Swile fornece esse dado. A API usa o CPF no servidor para criar o resumo e devolve ao app somente os dados necessários para a seleção. Pedidos são enviados depois da conferência dos valores, do total, da data e da forma de pagamento.

## Ativação no servidor

Solicite as credenciais corporativas de homologação e produção pelo canal oficial da Swile. Configure no servidor, em `/etc/energetica-swile.json`, um arquivo de propriedade `root:energetica-whatsapp` com modo `0640`:

```json
{
  "environment": "staging",
  "username": "<credencial corporativa>",
  "password": "<segredo corporativo>",
  "allowedEmails": ["<usuário Microsoft autorizado>"]
}
```

Instale as credenciais de produção e altere `environment` para `production` após validar a homologação. A configuração é lida no servidor, com um diário próprio por ambiente. Mantenha os segredos fora do repositório, do navegador e das ferramentas de build.

O instalador usa o lock de implantação existente, valida o hash do bridge, faz backup e restaura a versão anterior se a checagem de saúde falhar. Execute primeiro `sudo python3 deploy.py --expected-bridge HASH` e, após o check, repita com `--apply`. O serviço cria o diário em `/var/lib/energetica-whatsapp/swile` com acesso restrito. Uma solicitação com resultado incerto continua identificada pela referência externa. Consulte a Dash RH antes de autorizar novo envio.

O pedido e o pagamento têm estados distintos. Consulte a Dash RH para pagar e acompanhe o status na aba Swile.

[Documentação oficial da Swile](https://corporate-gateway.swile.com.br/docs/integration-guide.html)
