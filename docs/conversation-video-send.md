# MP4 nas conversas

O compositor e o histórico aceitam vídeo MP4 para todas as empresas. Mantêm a atribuição da conversa, a janela de 24 horas e a reserva de envio existente.

- MP4: até 16 MiB (16 × 1024 × 1024 bytes), extensão `.mp4` e MIME `video/mp4`.
- Interface orienta H.264 e AAC; não há transcodificação. A validação do servidor confere tamanho, MIME e assinatura do contêiner, não os codecs internos. A Meta pode recusar codecs incompatíveis.
- Prévia e histórico usam vídeo com controles e `playsInline`.
- Erros de seleção e envio ficam visíveis no diálogo. JPG/PNG (5 MiB), MP3 (16 MiB), PDF (100 MiB) e legenda (1.024 caracteres) preservados.

Configuração aplicada ao bucket privado existente, sem alterar políticas de acesso:

```sql
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'video/mp4')
where id = 'conversation-attachments'
  and allowed_mime_types is not null
  and not ('video/mp4' = any(allowed_mime_types));
```

Validação: testes do handler com transporte simulado cobrem payload de vídeo, histórico, limite, assinatura, janela de atendimento e isolamento por empresa/atendente. Nenhuma mensagem real é enviada por esses testes.
