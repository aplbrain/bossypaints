# BossyPaints

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Python](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Node](https://img.shields.io/badge/node-18+-green.svg)](https://nodejs.org/)

BossyPaints is a web-based 3D volumetric annotation tool designed for dense painting and proofreading of neuroscience datasets. It enables efficient annotation workflows using a task-based approach with small, manageable volumes, implementing the "small-and-many" proofreading strategy described in [Bishop et al. (2020)](https://ieeexplore.ieee.org/document/9630109/).

## Features

-   **🎨 Interactive 3D Painting**: Intuitive lasso-based annotation tools for volumetric data
-   **📊 BossDB Integration**: Native support for [BossDB](https://bossdb.org/) cloud storage and retrieval
-   **⚡ Collaboration**: Task-based workflow with user assignment and progress tracking
-   **🔄 Multi-resolution Support**: Efficient rendering across different zoom levels
-   **💾 Automatic Checkpointing**: Save progress incrementally with background processing
-   **🎯 Neuroglancer Integration**: Generate links to view annotations in [Neuroglancer](https://github.com/google/neuroglancer)
-   **📱 Touch Support**: Optimized for both desktop and tablet workflows

## Architecture

BossyPaints consists of two main components:

-   **Frontend**: SvelteKit-based web application with TypeScript
-   **Backend**: FastAPI server with Python for data processing and task management

### Frontend Stack

-   [SvelteKit](https://kit.svelte.dev/) - Web framework
-   [TypeScript](https://www.typescriptlang.org/) - Type safety
-   [p5.js](https://p5js.org/) - Canvas rendering and interaction
-   [Tailwind CSS](https://tailwindcss.com/) - Styling

### Backend Stack

-   [FastAPI](https://fastapi.tiangolo.com/) - API framework
-   [uvicorn](https://www.uvicorn.org/) - ASGI server
-   [intern](https://github.com/jhuapl-boss/intern) - BossDB Python client
-   [zmesh](https://github.com/seung-lab/zmesh) - 3D mesh generation

## Development

### Prerequisites

-   Python 3.11 or higher
-   Node.js 18 or higher
-   [uv](https://docs.astral.sh/uv/) (recommended Python package manager)

### Installation

1. **Clone the repository**

    ```bash
    git clone https://github.com/aplbrain/bossypaints.git
    cd bossypaints
    ```

2. **Set up the backend**

    ```bash
    cd server
    # Install uv if not already installed
    curl -LsSf https://astral.sh/uv/install.sh | sh

    # Install dependencies and run server
    uv run uvicorn server:app --reload
    ```

3. **Set up the frontend** (in a new terminal)

    ```bash
    cd bossypaints
    npm install
    npm run dev
    ```

4. **Access the application**

    Open your browser and navigate to `http://localhost:5173`

### Docker Deployment

For production deployment, use the provided Docker configuration:

```bash
docker-compose up -d
```

## 📖 Usage

### Getting Started

1. **Obtain BossDB API Token**: Visit [BossDB Token Management](https://api.bossdb.io/v1/mgmt/token) to generate your API token

2. **Create a Task**:

    - Navigate to "Create New Task"
    - Enter your BossDB collection, experiment, and channel details
    - Define the region of interest (ROI) for annotation
    - Specify destination collection for storing annotations

3. **Start Annotating**:
    - Use the paint brush tool to create regions
    - Hit backspace to subtract from regions
    - Use keyboard shortcuts for efficient workflow

### Keyboard Shortcuts

| Key                 | Action                             |
| ------------------- | ---------------------------------- |
| **Space**           | Toggle between paint and pan modes |
| **Backspace**       | Subtract current annotation        |
| **,** / **.**       | Navigate between Z layers          |
| **n** / **b**       | Next/previous segment ID           |
| **d**               | Delete current annotation          |
| **ESC**             | Reset view to task center          |
| **Alt + S**         | Save checkpoint                    |
| **Alt + Shift + S** | Final submission                   |

### API Endpoints

The backend provides a RESTful API for task management:

-   `GET /api/tasks` - List all tasks
-   `POST /api/tasks/create` - Create new annotation task
-   `GET /api/tasks/{task_id}` - Get specific task details
-   `POST /api/tasks/{task_id}/checkpoint` - Save annotation checkpoint
-   `POST /api/tasks/{task_id}/save` - Final task submission

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the server directory:

```env
KEYCLOAK_URL=<your-keycloak-url>
KEYCLOAK_CLIENT_ID=<your-client-id>
#KEYCLOAK_CLIENT_SECRET=<your-client-secret>
PUBLIC_BOSSYPAINTS_API_URL=""
```

### Frontend Configuration

Modify `bossypaints/src/lib/webpaint/config.ts` for application settings:

```typescript
export default {
    debug: false,
    fixedChunkSize: {
        width: 512,
        height: 512,
        depth: 16,
    },
    chunkLoading: {
        radius: 2,
        prioritizeCenter: true,
    },
};
```

### Development Setup

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests if applicable
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Style

-   Frontend: Follow Prettier and ESLint configurations
-   Backend: Follow PEP 8 with Black formatting
-   Use TypeScript for all frontend code
-   Include type hints for Python functions

## Issue Reporting

Found a bug? Please report it on our [Issues page](https://github.com/aplbrain/bossypaints/issues) with:

-   Operating system and browser version
-   Steps to reproduce the issue
-   Expected vs actual behavior
-   Screenshots if applicable

## 🙏 Acknowledgments

-   [Bishop et al. (2020)](https://ieeexplore.ieee.org/document/9630109/) for the small-and-many proofreading methodology
-   [BossDB](https://bossdb.org/) team for cloud infrastructure
-   [Neuroglancer](https://github.com/google/neuroglancer) for visualization integration
-   The neuroscience open-source community

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

<p align='center'><small>Made with 💙 at <a href='http://www.jhuapl.edu/'><img alt='JHU APL' align='center' src='https://user-images.githubusercontent.com/693511/62956859-a967ca00-bdc1-11e9-998e-3888e8a24e86.png' height='42px'></a></small></p>
