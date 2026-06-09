<script>
	import MapContainer from '$components/map/MapContainer.svelte';
	import TopBar from '$components/topbar/TopBar.svelte';
	import Drawer from '$components/drawer/Drawer.svelte';
	import PeerList from '$components/sync/PeerList.svelte';
	import HistoryPanel from '$components/ui/HistoryPanel.svelte';
	import ToastContainer from '$components/ui/ToastContainer.svelte';
</script>

<MapContainer />
<TopBar />
<Drawer />
<PeerList />
<HistoryPanel />
<ToastContainer />