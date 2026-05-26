import os

from zmesh import Mesher
from intern import array as intern_array

from bossypaints.renderer import (
    ImageStackVolumePolygonRenderer,
    BossDBInternVolumePolygonRenderer,
    LocalCloudVolumePolygonRenderer,
)
from bossypaints.tasks import JSONFileTaskQueueStore, Task, TaskID, TaskQueueStore
from bossypaints.checkpoints import (
    Checkpoint,
    JSONCheckpointStore,
    build_segment_canonical_map,
)

def _mesh_batch_size(task: Task, total_ids: int) -> int:
    env_size = os.getenv("BOSSYPAINTS_MESH_BATCH_SIZE")
    if env_size:
        try:
            return max(1, int(env_size))
        except ValueError:
            pass

    env_bytes = os.getenv("BOSSYPAINTS_MESH_BATCH_BYTES", str(1 << 30))
    try:
        target_bytes = max(1, int(env_bytes))
    except ValueError:
        target_bytes = 1 << 30

    voxel_size = 1
    x_size = int((task.x_max - task.x_min) / voxel_size)
    y_size = int((task.y_max - task.y_min) / voxel_size)
    z_size = int((task.z_max - task.z_min) / voxel_size)

    channel_bytes = max(1, x_size * y_size * z_size * 8)
    return max(1, min(total_ids, target_bytes // channel_bytes))

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
        latest_merge_groups = checkpoints[-1].mergeGroups if checkpoints else []
        canonical_segment_ids = build_segment_canonical_map(latest_merge_groups)
        segment_ids = sorted(
            {
                canonical_segment_ids.get(poly.segmentID, poly.segmentID)
                for checkpoint in checkpoints
                for poly in checkpoint.polygons
            }
        )
        if not segment_ids:
            return

        batch_size = _mesh_batch_size(task, len(segment_ids))
        for offset in range(0, len(segment_ids), batch_size):
            batch_ids = segment_ids[offset:offset + batch_size]
            vols = cv_renderer._materialize_xyz_volume(task, checkpoints, as_channels=True, segment_ids=batch_ids)
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
            del vols

    finally:
        # Always reset the export_pending flag when export completes (success or failure)
        if task_store:
            task_store.update_export_pending(task_id, False)
