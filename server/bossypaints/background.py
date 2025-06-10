from zmesh import Mesher
from intern import array as intern_array

from bossypaints.renderer import (
    ImageStackVolumePolygonRenderer,
    BossDBInternVolumePolygonRenderer,
)
from bossypaints.tasks import JSONFileTaskQueueStore, Task, TaskID
from bossypaints.checkpoints import Checkpoint, JSONCheckpointStore

def render_and_mesh(task_id: str, task: Task, checkpoints: list[Checkpoint]):
    # if task.destination_collection and task.destination_experiment and task.destination_channel:
    #     BossDBInternVolumePolygonRenderer().render_from_checkpoints(
    #         task, checkpoints
    #     )
    #     # TODO: Render to mesh.
    # else:
    isvpr = ImageStackVolumePolygonRenderer(
        fmt="tif", directory=f"./exports/{task_id}/"
    )
    isvpr.render_from_checkpoints(task, checkpoints)
    # Also trigger mesh generation.
    # First, we need to get the voxel shapes.
    print(intern_array(
        f"bossdb://{task.destination_collection}/{task.destination_experiment}/{task.destination_channel}"
    ).voxel_size)
    mesher = Mesher((1,1,1)) # TODO: Get the resolution from the task
    vols = isvpr._materialize_xyz_volume(task, checkpoints, as_channels=True)
    # vols = (x, y, z, C)
    for c in range(vols.shape[-1]):
        vol = vols[:, :, :, c]
        mesher.mesh(vol, close=False)
        for objid in mesher.ids():
            mesh = mesher.get(objid, normals=False,
                            # reduction_factor=10, max_error=2
                            )
            with open(f"./exports/{task_id}/{objid}.obj", "wb") as f:
                f.write(mesh.to_obj())
