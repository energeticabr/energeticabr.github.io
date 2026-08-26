# Energética Construções

Site institucional e portal administrativo estático da Energética. O portal usa login Microsoft e consulta o SharePoint diretamente com a identidade do usuário conectado. Os registros administrativos não são duplicados em outra base.

## Portal administrativo

- Endereço: `https://www.energeticabr.com/admin.html`
- Autenticação: Microsoft Entra ID, sem senha própria no site.
- Superadministrador inicial: `bernardonotini@energeticabr.com`.
- Fonte operacional: listas dos dois sites SharePoint configurados.
- Sessão: o fluxo por redirecionamento usa somente o cache temporário gerenciado pelo MSAL em `sessionStorage`. Esse cache pertence à aba atual e é apagado quando a aba for fechada ou no logout; o portal não grava segredos próprios, registros do SharePoint nem credenciais nesse armazenamento.

### Aplicativo Microsoft

Configuração pública em `portal/config.js`:

- Tenant: `0c10f511-7ede-4702-a2d9-bedb26937e0e`
- Client ID: `94018e25-f756-4aa6-974e-27b8b43d7fe9`
- Redirect URI: `https://www.energeticabr.com/admin.html`

Escopos delegados usados pelo portal:

| Momento | Escopos | Finalidade |
| --- | --- | --- |
| Entrada | `openid`, `profile`, `email`, `User.Read` | Identificar a conta Microsoft. |
| Dados | `Sites.ReadWrite.All` | Ler e alterar listas permitidas pela conta conectada. |
| Verificação de acesso | `Sites.Read.All` | Conferir as permissões efetivas de `PORTAL_ACESSOS`. |
| Criação inicial | `Sites.Manage.All` | Criar `PORTAL_ACESSOS` quando ela ainda não existe; solicitado somente ao superadministrador. |
| Anexos | `https://<host-sharepoint>/.default` | Abrir, enviar e excluir anexos no host SharePoint autorizado. |

O aplicativo deve ser do tipo SPA e ter apenas o endereço público acima como Redirect URI de produção. Nenhum segredo de aplicativo, chave privada ou permissão de aplicação deve ser colocado neste repositório.

### MSAL local e política de conteúdo

O portal não executa a biblioteca de autenticação por CDN. A versão exata `@azure/msal-browser 5.19.0` foi obtida do pacote oficial e está versionada em `portal/vendor/msal-browser-5.19.0.min.js`, acompanhada da licença MIT e do arquivo de origem/versão. Ao atualizar a biblioteca, substitua os três arquivos, registre a nova integridade do pacote e ajuste os testes que fixam a versão.

Como o GitHub Pages não permite definir cabeçalhos HTTP personalizados por página, `admin.html` aplica uma Content Security Policy por `<meta http-equiv>`. Ela aceita scripts e estilos somente da própria origem, conexões apenas com Microsoft Graph, login Microsoft e os dois hosts SharePoint configurados, além do frame de autenticação Microsoft. Não são permitidos `unsafe-eval`, scripts externos ou estilos inline.

## Sites SharePoint

| Chave | Endereço |
| --- | --- |
| `company` | `https://energeticaltda.sharepoint.com/sites/energetica` |
| `personal` | `https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com` |

Os nomes e aliases das listas ficam em `portal/catalog/entities.js`. Uma lista ausente ou sem permissão afeta apenas a entidade correspondente; as demais áreas continuam disponíveis.

## Configurar `PORTAL_ACESSOS`

1. Entre no portal com `bernardonotini@energeticabr.com`.
2. Abra **Usuários e Acessos**.
3. Use **Configurar lista** se `PORTAL_ACESSOS` ainda não existir e conclua o consentimento Microsoft solicitado.
4. No SharePoint corporativo, abra as configurações de permissão da lista e interrompa a herança.
5. Conceda escrita ou controle somente ao superadministrador.
6. Conceda leitura direta a cada usuário autorizado. A verificação de segurança não aceita grupos, aplicações, links compartilhados ou identidades que não possam ser confirmadas individualmente.
7. Volte ao portal, cadastre o usuário e marque módulos e ações necessários. Permissão ausente significa acesso negado.

Ocultar um botão não concede segurança. O portal revalida a ação, e o SharePoint ainda precisa autorizar a operação para a conta Microsoft conectada.

### Recuperação de acesso

O superadministrador configurado continua entrando mesmo quando a lista está ausente ou com ACL incompleta. Em caso de bloqueio dos demais usuários:

1. Confirme que a conta usada é `bernardonotini@energeticabr.com`.
2. Verifique se `PORTAL_ACESSOS` existe no site corporativo e não herda permissões.
3. Remova qualquer identidade com escrita diferente do superadministrador.
4. Conceda leitura direta ao usuário afetado e confirme que o registro dele está `ATIVO`.
5. Revise as permissões por módulo e ação e entre novamente no portal.

Se a lista tiver sido excluída, o superadministrador pode recriá-la pela tela de acessos e repetir a configuração de permissões exclusivas.

## Adicionar uma entidade

1. Identifique o site e o nome exato da lista SharePoint.
2. Adicione uma definição única em `portal/catalog/entities.js` com `id`, `moduleId`, `title`, `siteKey`, `listNames`, `searchFields` e `statusFields`.
3. Mantenha `create`, `edit`, `delete` e `approve` desativados por padrão. Habilite somente ações comprovadamente existentes no processo.
4. Configure `uppercaseFields` apenas para campos cadastrais e `messageFields` para textos cuja capitalização deve ser preservada.
5. Atualize `tests/portal-catalog.test.mjs` e os testes da página afetada.
6. Rode a suíte completa antes de publicar.

## Verificação local

Use o Node empacotado pelo ambiente Codex:

```powershell
& 'C:\Users\Bernardonotini\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\*.test.mjs
& 'C:\Users\Bernardonotini\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\admin-microsoft-login.test.js
& 'C:\Users\Bernardonotini\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\no-hardcoded-credentials.test.js
& 'C:\Users\Bernardonotini\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\remove-client-area.test.js
```

Para visualização, sirva a raiz por HTTP. O login real usa o Redirect URI público; a verificação local sem credenciais cobre a tela institucional e os estados simulados das páginas administrativas.
