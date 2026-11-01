# dd — voz e tela para duas pessoas

Aplicativo web em português com frontend sem build, backend Node.js/WebSocket e mídia WebRTC. O código inclui salas privadas, chat, reconexão, áudio Opus, captura de tela, controles de qualidade e estatísticas reais.

## Começar no seu computador

Instale Node.js 22.9 ou superior (com npm), abra um terminal nesta pasta e execute:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Abra **http://127.0.0.1:3210** no navegador. Digite seu apelido e crie uma sala. Para testar no mesmo computador, abra o convite em outra janela/perfil e use fones. Não abra index.html diretamente: o servidor é necessário.

O endereço local só funciona no seu computador. Para seu amigo entrar de outro lugar, hospede o backend com HTTPS conforme abaixo. Não há um servidor público de sinalização ou TURN pré-configurado nesta entrega.

## O que está implementado

- Duas pessoas por sala, identificador aleatório de 192 bits e apelido sem cadastro.
- Entrada por link/código; vagas de conexões interrompidas reservadas por 30 segundos com token de retomada. Salas vazias são removidas. Reiniciar o backend apaga salas.
- Chat somente em memória, limite de 4.000 caracteres por mensagem; texto renderizado como texto, sem executar HTML.
- Voz Opus: automático e 32/48/64/96/128/160/192/256/320/510 kbps; seleção de microfone/saída; captura mono/estéreo; modos Voz/Música/Personalizado.
- Tratamento de eco, ruído e ganho via APIs do navegador; medidor de microfone; microfone aberto, ativação por voz com limiar e apertar para falar (Espaço).
- Fluxos separados de voz e áudio da tela, com volumes independentes e silenciamento em zero.
- Compartilhamento de tela/janela/aba usando o seletor nativo. Captura de áudio solicitada separadamente e aviso quando a fonte não o fornece.
- Resoluções alvo 480p/720p/1080p/1440p/2160p/original; FPS 5/10/15/24/30/60.
- Limites de vídeo: automático, 1/2/4/6/8/10/12/16/20/25/30/40/50/60/80/100 Mbps e campo personalizado de 500 kbps a 100 Mbps.
- Perfis texto/movimento, modo adaptativo/priorizar qualidade, troca da fonte, tela cheia e tamanho original.
- Atualização dos limites via RTCRtpSender.setParameters; resolução/FPS via applyConstraints; troca de trilhas via replaceTrack.
- Proteção de voz: prioridade alta solicitada ao WebRTC; algoritmo adicional reduz o teto de vídeo em 30% quando detecta RTT acima de 350 ms, jitter de áudio acima de 50 ms ou perda de áudio acima de 3%. Recuperação gradual após amostras saudáveis. É uma estratégia de melhor esforço, não garantia de QoS.
- Diagnóstico a cada dois segundos: parâmetros solicitados, parâmetros retornados pelo navegador, taxas calculadas por diferença de bytes, resolução/FPS reportados, codecs, RTT, jitter, perda acumulada e conexão direta/TURN.
- Credenciais TURN temporárias com HMAC-SHA1 geradas apenas no backend; segredo permanente fora do frontend.

## Configuração e HTTPS

O backend deve rodar em **uma instância Node persistente**, com suporte a WebSocket. Não distribua as salas em várias instâncias sem implementar armazenamento/coordenação compartilhados. O frontend e o backend podem ser hospedados juntos, que é o caminho mais simples.

Exemplo de `.env` em produção:

```dotenv
PORT=3210
HOST=127.0.0.1
ALLOWED_ORIGINS=https://dd.seudominio.com
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=turn:turn.seudominio.com:3478?transport=udp,turn:turn.seudominio.com:3478?transport=tcp,turns:turn.seudominio.com:5349?transport=tcp
TURN_SECRET=SUBSTITUA_POR_UM_SEGREDO_ALEATORIO_LONGO
TURN_TTL_SECONDS=3600
```

Em um servidor Linux com domínio apontando para o IP correto, Caddy pode terminar HTTPS e encaminhar HTTP/WebSocket. O arquivo `deploy/Caddyfile.example` contém a configuração. Libere 80 e 443 no servidor, configure DNS e execute Caddy como serviço. Ele gerencia o certificado para o domínio configurado. Mantenha o Node sob um gerenciador de serviços e use apenas a porta local atrás do proxy. Se sua plataforma exige escutar em todas as interfaces, configure HOST=0.0.0.0 e controle a exposição na plataforma.

`ALLOWED_ORIGINS` deve conter a origem exata do frontend (protocolo, domínio e porta quando houver), sem barra final. Não use `*`. WebSocket valida Origin no upgrade. O backend aplica limite de mensagens, tamanho de payload, conexões por IP e quantidade de salas. Atrás de proxy, o limite por IP conta o proxy; esta versão é dimensionada para duas pessoas, não um serviço público grande.

### Frontend em Sites

O manifesto `.openai/hosting.json` publica **apenas a interface estática em dist**, gerada de public por `npm run build`. O servidor Node e o TURN não passam a funcionar por publicar esses arquivos estáticos. A interface permite informar o backend HTTPS em Configurações → Conexão. Os dois participantes precisam usar o mesmo backend. Adicione a origem publicada a ALLOWED_ORIGINS e configure o mesmo endereço em ambos os navegadores. Os convites não importam silenciosamente um servidor externo.

Uma publicação privada em Sites não dá acesso automático ao seu amigo. Para usar imediatamente sem depender das permissões do Sites, hospede este projeto inteiro no seu próprio domínio e compartilhe o link desse domínio. Nenhuma alteração de público ou convite por e-mail é feita pelo aplicativo.

## TURN com coturn

Use um servidor coturn acessível publicamente, de preferência com IP público direto. Instale coturn conforme o sistema do servidor. Copie `deploy/turnserver.conf.example`, substitua domínio, caminhos de certificados e o segredo. O `static-auth-secret` deve ser **igual** ao TURN_SECRET do backend. Nunca coloque esse segredo em JavaScript público ou commit.

Abra 3478 UDP/TCP, 5349 TCP para TURN sobre TLS e o intervalo UDP de relay 49160–49200 definido no exemplo. Use certificados válidos para o domínio TURN. Se houver NAT, configure external-ip com o mapeamento público/privado correto; liberar somente a porta 3478 não basta para mídia.

O exemplo inclui quotas, bloqueio de destinos locais e multicast. Ajuste às interfaces/rede do servidor e valide as regras antes de operar. Credenciais são renovadas pelo cliente durante a sala; atualizá-las não necessariamente refaz uma alocação existente. Teste chamadas longas e reconexão no provedor escolhido.

Para comprovar o relay, ative **Usar somente TURN** antes de entrar, conecte os dois computadores e confira “REDE: TURN” no diagnóstico. Não considere o TURN validado apenas porque credenciais foram emitidas.

## Compatibilidade e limites reais

| Recurso | Comportamento / limitação |
| --- | --- |
| Microfone e tela | Precisam de HTTPS ou localhost e permissão explícita do navegador. |
| Áudio do sistema/aba | Depende de navegador, sistema operacional e fonte escolhida. O app avisa se não recebe trilha de áudio. |
| Chrome/Edge no desktop | São alvos de implementação; disponibilidade de áudio varia por fonte e sistema. Não foi feita homologação completa de versões. |
| Firefox/Safari | Recursos são detectados quando possível; saída de áudio, conteúdo da captura e campos RTP podem diferir. Consulte a UI e teste no navegador usado. |
| Celular | Interface responsiva; captura de tela pode estar indisponível. Não há promessa de paridade com desktop. |
| Estéreo | O app solicita canais na captura/Web Audio e negocia recepção estéreo Opus. Um microfone mono continua sendo uma fonte mono. |
| Taxa de bits | É um teto solicitado, sujeito ao codec, negociação, processamento e congestionamento. Uma tela parada não usa 100 Mbps só porque esse teto foi escolhido. |
| Resolução/FPS | São alvos/limites. O navegador mantém as dimensões disponíveis da fonte e faz redução; o app não cria pixels extras. Diagnóstico usa as dimensões reais quando reportadas. |
| Prioridade de áudio | Melhor esforço. Nem todo navegador aplica prioridades de rede; saturação extrema também prejudica voz. |
| Apertar para falar | Espaço com janela em foco e fora de campos/botões. Perder o foco interrompe a transmissão. Atalho global precisa de integração nativa. |
| Teste de microfone | Medidor de nível, sem reprodução local para não gerar eco. |
| Mudança de captura de áudio da tela | Exige “Trocar fonte” e nova seleção no navegador. |
| Mudança do microfone/canais/tratamento | Pode abrir novamente o dispositivo. Se replaceTrack rejeitar por limite negociado, o app informa erro; reentre na sala para renegociar. |
| Preferências parcialmente rejeitadas | A interface mostra o erro e o diagnóstico permite consultar os parâmetros atuais. O navegador pode ignorar preferências opcionais. |
| Mensagens e privacidade | Mensagens passam pelo servidor via WebSocket e não são persistidas pelo app. Mídia usa DTLS-SRTP entre participantes, inclusive quando retransmitida por TURN. Quem possui o link pode ocupar uma vaga. |

## Verificação

Execute `npm test` para validar o backend. Foram executados e aprovados quatro testes: limite de participantes/roteamento/chat/saída, reconexão e expiração, credenciais TURN, rejeição de origem e proteção de arquivos. `node --check` aprovou os arquivos JavaScript. As verificações de interface e a lista de limites também foram abertas no navegador local.

**Não há comprovação de qualidade de áudio, 4K/60 FPS, 100 Mbps, TURN externo ou funcionamento entre duas redes reais nesta entrega.** Execute o roteiro em `TESTES-MANUAIS.md` antes de considerar a aplicação homologada. Os testes automatizados de sinalização não substituem uma chamada real.

Referências usadas na implementação:
- [WebRTC: negociação](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
- [Parâmetros de transmissão](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters)
- [Captura de tela](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Configuração oficial do coturn](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)
- [Proxy reverso do Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
