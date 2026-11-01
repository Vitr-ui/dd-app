# Roteiro de validação em dois computadores

Use dois computadores com fones, em redes diferentes (por exemplo, uma conexão doméstica e um hotspot). Abra o mesmo backend HTTPS em ambos. Registre navegador/versão, sistema, upload/download, fonte da tela e horário. Os itens abaixo são verificações pendentes de execução real, não resultados aprovados.

1. **Sala:** A cria, B entra pelo convite. Confirmar dois participantes e que C recebe “sala já tem duas pessoas”.
2. **Voz bidirecional:** alternar fala e ouvir dos dois lados por cinco minutos. Verificar inteligibilidade, atraso percebido, cortes e indicadores de fala. Trocar microfone/saída e confirmar o dispositivo de fato usado.
3. **Tratamento:** comparar Voz e Música com fones; habilitar/desabilitar eco, ruído e ganho. Conferir os valores de captura no aviso de configurações; registrar opções ignoradas.
4. **Silenciamento:** silenciar microfone, áudio recebido e volume da tela em zero separadamente. A voz não deve desaparecer ao silenciar apenas a tela. Sair da sala deve liberar o indicador de uso de microfone.
5. **VAD/PTT:** limiar baixo/alto deve mudar a ativação. Pressionar Espaço fora dos campos, soltar e mudar o foco; confirmar interrupção da transmissão. Digitar espaços no chat não deve ativar PTT.
6. **Tela:** escolher aba, janela e monitor; verificar seleção, proporção, legibilidade, tela cheia, tamanho original e áudio quando disponível. Testar os dois participantes compartilhando. Não compartilhar dados pessoais no teste.
7. **Troca/encerramento:** trocar fonte, cancelar seletor, parar pelo app e pelo indicador do navegador. Confirmar que a captura antiga termina e que o amigo vê o estado correto.
8. **Qualidade:** testar 720p/30/4 Mbps, 1080p/60/16 Mbps e, com hardware/rede adequados, 1440p/4K e tetos 30/50/100 Mbps. Usar cena em movimento. Comparar alvo, parâmetros aplicados e envio/recebimento medidos. Não esperar que cena estática atinja o teto.
9. **Limite personalizado:** testar 500 kbps, 12,5 Mbps, 100 Mbps e valores fora do intervalo. Reabrir navegador e confirmar persistência.
10. **Congestionamento:** usar limitador de tráfego no sistema/roteador (a simulação HTTP do DevTools pode não limitar WebRTC UDP). Reduzir banda durante vídeo e falar continuamente. Registrar jitter, RTT, perdas e teto adaptativo; confirmar redução do vídeo e recuperação gradual. Avaliar o áudio por escuta, não apenas por estatísticas.
11. **Reconexão:** interromper rede por 5–10 segundos, restaurar e verificar retomada de mídia e chat. Após mais de 30 segundos fora, verificar liberação da vaga. Reiniciar servidor e confirmar mensagem clara de sala encerrada.
12. **TURN:** marcar “Usar somente TURN” nos dois navegadores antes de entrar; confirmar voz, vídeo e “REDE: TURN”. Testar chamada por mais de uma hora para validar renovação/alocações.
13. **Falhas:** negar permissões, desconectar microfone, usar código inválido e desligar backend. Confirmar mensagens claras e ausência de captura após sair.
14. **Compatibilidade:** repetir em navegadores e sistemas que vocês pretendem usar. Captura de áudio do sistema/aba precisa ser validada em cada combinação.

Registre resultado (passou/falhou), métricas e observações por item. Só marque voz/prioridade sob congestionamento como validada após escuta dos dois participantes em rede limitada.
