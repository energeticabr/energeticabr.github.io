# Energética Construções

Site estático publicado no GitHub Pages com galeria de obras e captação de interessados integrada ao Supabase.

## Páginas

- `index.html`: site público.
- `admin.html`: painel para login, upload/exclusão de fotos e acompanhamento de interessados.
- `cliente.html`: área do cliente para acompanhar unidade, etapa, documentos e mensagens.
- `supabase-config.js`: URL e chave pública do projeto Supabase.
- `supabase-setup.sql`: SQL para criar tabela, bucket e permissões.

## Como ativar o painel

1. Abra o projeto no Supabase.
2. Vá em SQL Editor.
3. Cole e rode o conteúdo de `supabase-setup.sql`.
   - Se o painel já estava ativo antes, rode novamente para criar o campo de e-mail dos interessados e a área do cliente.
4. Vá em Project Settings > API.
5. Copie a `anon public key`.
6. Edite `supabase-config.js` e troque `COLE_SUA_ANON_PUBLIC_KEY_AQUI` pela chave.
7. Vá em Authentication > Users e crie o usuário que acessará o painel.

Depois disso, acesse:

```text
https://energeticabr.github.io/admin.html
```

As fotos cadastradas aparecem automaticamente em:

```text
https://energeticabr.github.io/#obras
```

Os interessados enviados pelo formulário do site ficam no painel administrativo, na seção "Interessados recebidos".

## Como ativar a área do cliente

1. Rode o `supabase-setup.sql` atualizado.
2. No Supabase, vá em Authentication > Users e crie o usuário do cliente com o mesmo e-mail cadastrado no painel.
3. No painel administrativo, cadastre o cliente na seção "Área do cliente".
4. O cliente acessa:

```text
https://energeticabr.github.io/cliente.html
```

O primeiro usuário criado no Supabase é incluído automaticamente como administrador em `admin_users`.
