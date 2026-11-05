# Skill proof

I read gitbrew-post SKILL.md (hard request).

repo: YPAAAAAAAAAAAAA/stylized-water-anime
play: play.html
official: vendor/water.js

- ready: /sandbox/_ready.js present (GitBrew host path); first playable-ready passes the local check.mjs ready gate
- local vendor: relative ./vendor only; no remote css/js/font
- ratio/island: phone max-height 120vw (PLAY_ISLAND_VW=1.2); html,body height 100%
- composition: viewport-fit=cover; overflow:hidden; dock as sibling

The page is the water effect alone. WebGL2 fills `#stage` / `#canvas`. No WebGPU, no remote runtime, no debug panel.
