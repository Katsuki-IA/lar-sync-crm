# Áudio nas conversas

Botão de microfone disponível para todas as empresas. Gravação de até cinco minutos,
prévia, descarte e envio explícito, com alternativa de anexar MP3 até 16 MiB.
O navegador solicita acesso ao microfone somente ao iniciar a gravação; faixas são
encerradas ao parar, fechar o diálogo, trocar de conversa ou perder permissão de envio.

A gravação nativa é decodificada e convertida em MP3 mono 44,1 kHz / 96 kbps no cliente.
O codificador LAME é importado dinamicamente e sem modificações. Aviso e fonte em
`/licenses/lamejs.txt`. Gravações não são enviadas antes da confirmação do atendente.

O endpoint existente mantém autenticação, empresa, atribuição, janela de 24 horas e
reserva idempotente. Valida tamanho, MIME, extensão, assinatura e caminho do upload.
Payload de áudio não inclui legenda nem filename. Histórico preserva anexo com kind
audio e player, incluindo a recuperação idempotente já existente.

Configuração do bucket privado (aplicada no projeto):
```sql
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'audio/mpeg')
where id='conversation-attachments' and not ('audio/mpeg'=any(allowed_mime_types));
```

Validação: testes do envio de mídia, áudio recebido e codificação MP3 real; TypeScript.
Nenhum áudio foi enviado a contatos reais durante os testes automatizados.
