# Swile no Energético

**Recursos Humanos → Swile** consulta os colaboradores e grupos da Corporate Gateway API, verifica a disponibilidade de Multibenefícios (`v13`) e informa o estado do cartão físico quando a Swile fornece esse dado. A API usa o CPF no servidor para criar o resumo e devolve ao app somente os dados necessários para a seleção. Pedidos são enviados depois da conferência dos valores, do total, da data e da forma de pagamento.

## Ativação no servidor

Solicite as credenciais corporativas de homologação e produção pelo canal oficial da Swile. Configure no servidor, em `/etc/energetica-swile.json`, um arquivo de propriedade `root:energetica-whatsapp` com modo `0640`:

```json
{
  "environment": "staging",
  "username": "<credencial corporativa>",
  "password": null,
  "allowedEmails": ["<usuário Microsoft autorizado>"]
}
```

Substitua `null` pelo segredo fornecido pela Swile ao criar o arquivo privado. Instale as credenciais de produção e altere `environment` para `production` após validar a homologação. A configuração é lida no servidor, com um diário próprio por ambiente. Mantenha os segredos fora do repositório, do navegador e das ferramentas de build.

O instalador usa o lock de implantação existente, valida os hashes do bridge e do módulo, faz backup e restaura a versão anterior se a checagem de saúde falhar. Execute primeiro `sudo python3 deploy.py --expected-bridge HASH_DO_BRIDGE --expected-module HASH_DO_MODULO` e, após o check, repita com `--apply`. Na primeira instalação, use `--expected-module absent`. O serviço cria o diário em `/var/lib/energetica-whatsapp/swile` com acesso restrito. Atualizar o status de um envio incerto tenta localizar a referência externa na Swile. Confira na Dash RH quando a integração ainda não conseguir localizar o pedido.

A Galeria Swile atualiza as listas **Em aberto** e **Histórico** todos os dias às 07h e 17h no horário de Brasília, com os boletos e as notas fiscais já disponibilizados pelo Corporate Gateway. Os PDFs são baixados das origens oficiais quando abertos. O botão de sincronização da lista consulta a Swile na hora e grava as duas listas juntas. Uma falha de consulta preserva a última atualização.

Após implantar o módulo, instale `energetica-swile-gallery.service` e `energetica-swile-gallery.timer` com modo `0644` em `/etc/systemd/system`. Execute `sudo systemctl daemon-reload`, `sudo systemctl start energetica-swile-gallery.service` para a primeira coleta e `sudo systemctl enable --now energetica-swile-gallery.timer` para manter o agendamento. Confira a coleta no journal da unidade de serviço e o próximo horário em `systemctl list-timers energetica-swile-gallery.timer`.

O pedido e o pagamento têm estados distintos. Consulte a Dash RH para pagar e acompanhe o status na aba Swile.

[Documentação oficial da Swile](https://corporate-gateway.swile.com.br/docs/integration-guide.html)
