from zmesh import Mesher
from intern import array as intern_array

from bossypaints.renderer import (
    ImageStackVolumePolygonRenderer,
    BossDBInternVolumePolygonRenderer,
    LocalCloudVolumePolygonRenderer,
)
from bossypaints.tasks import JSONFileTaskQueueStore, Task, TaskID, TaskQueueStore
from bossypaints.checkpoints import Checkpoint, JSONCheckpointStore

def render_and_mesh(task_id: str, task: Task, checkpoints: list[Checkpoint], task_store: TaskQueueStore = None):
    try:
        # If the user selected BossDB output and provided a destination, render there; otherwise use local CloudVolume for download
        if (
            getattr(task, "output_type", "download") == "bossdb"
            and task.destination_collection
            and task.destination_experiment
            and task.destination_channel
        ):
            BossDBInternVolumePolygonRenderer().render_from_checkpoints(task, checkpoints)
            # TODO: Mesh generation to BossDB or elsewhere if desired.
            return

        # Default to local CloudVolume export for download
        cv_renderer = LocalCloudVolumePolygonRenderer(directory=f"./exports/{task_id}/", base_name="segmentation")
        cv_path = cv_renderer.render_from_checkpoints(task, checkpoints)

        # Also create legacy TIFF exports for backward compatibility
        # isvpr = ImageStackVolumePolygonRenderer(fmt="tif", directory=f"./exports/{task_id}/")
        # isvpr.render_from_checkpoints(task, checkpoints)

        # Trigger mesh generation using the CloudVolume data
        # # TODO: Determine voxel_size from source; fallback to (1,1,1)
        # try:
        #     if task.destination_collection and task.destination_experiment and task.destination_channel:
        #         print(
        #             intern_array(
        #                 f"bossdb://{task.destination_collection}/{task.destination_experiment}/{task.destination_channel}"
        #             ).voxel_size
        #         )
        # except Exception:
        #     pass
        mesher = Mesher((1, 1, 1))  # TODO: Get the resolution/voxel size from the task/source
        vols = cv_renderer._materialize_xyz_volume(task, checkpoints, as_channels=True)
        # vols = (x, y, z, C)
        for c in range(vols.shape[-1]):
            vol = vols[:, :, :, c]
            mesher.mesh(vol, close=False)
            for objid in mesher.ids():
                mesh = mesher.get(
                    objid,
                    normals=False,
                    # reduction_factor=10, max_error=2
                )
                with open(f"./exports/{task_id}/{objid}.obj", "wb") as f:
                    f.write(mesh.to_obj())

    finally:
        # Always reset the export_pending flag when export completes (success or failure)
        if task_store:
            task_store.update_export_pending(task_id, False)
