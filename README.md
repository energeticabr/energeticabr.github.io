# Energética Construções

Site estático publicado no GitHub Pages com galeria de obras integrada ao Supabase.

## Páginas

- `index.html`: site público.
- `admin.html`: painel para login, upload e exclusão de fotos.
- `supabase-config.js`: URL e chave pública do projeto Supabase.
- `supabase-setup.sql`: SQL para criar tabela, bucket e permissões.

## Como ativar o painel

1. Abra o projeto no Supabase.
2. Vá em SQL Editor.
3. Cole e rode o conteúdo de `supabase-setup.sql`.
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
