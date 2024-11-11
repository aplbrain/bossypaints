# bossypaints


bossypaints is designed to allow BossDB users to queue tasks for dense 3D painting annotation in small incremental volumes, using the small-and-many proofreading strategy described in [Bishop et al. 2020](https://ieeexplore.ieee.org/document/9630109/)

Imagine this as a super lame alternative to a real [NeuVue](https://www.biorxiv.org/content/10.1101/2022.07.18.500521v1.full) stack with a dense paint application for BossDB annotation. This repository serves as a proof-of-concept as we work on integrating this tooling into the BossDB+NeuVue platform.

## Installation

```bash
uv run uvicorn server:app --reload
```
