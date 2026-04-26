# IA HandTracker

App web local para abrir a camera, detectar maos e desenhar os 21 landmarks do MediaPipe Hands em tempo real.

## Como rodar

```bash
python3 -m http.server 5173
```

Depois abra:

```text
http://localhost:5173
```

O navegador precisa de permissao de camera e acesso a internet para baixar o MediaPipe pelo CDN.

## Recursos

- Preview da camera com landmarks e conexoes da mao.
- Rastreamento de 1 ou 2 maos.
- Ajuste de confianca de deteccao e tracking.
- Alternancia entre camera frontal e traseira quando disponivel.
- Leitura das coordenadas dos principais pontos da primeira mao detectada.
- Easter egg: faca o gesto de rock para ativar o modo Harry Potter.
- No modo Harry Potter, estenda o indicador para desenhar na tela e use o mesmo gesto de rock para sair.
- Os tracos somem em aproximadamente 3 segundos, criando efeito de trailing.
- Desenhar um raio ativa Avada Kedavra: o proprio raio desenhado acende em verde, com nome do feitico, aneis de impacto, faiscas e glow com fade in/out.
- Desenhar um traço horizontal ativa Lumos: a area da camera recebe um clarão branco de alta intensidade, com aproximadamente 85% de opacidade.
- Desenhar um circulo ativa Nox: a area da camera escurece com fade in/out, como o contrario do Lumos.
- Abrir e fechar a mao duas vezes seguidas ativa/desativa o modo tela cheia da camera. Use Esc ou o botao "Sair da tela cheia" para sair.

