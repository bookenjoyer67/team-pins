<script>
	import { dialogs } from '$lib/stores/dialogs.js';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import AlertDialog from './AlertDialog.svelte';
	import PasswordDialog from './PasswordDialog.svelte';
	import SetPasswordDialog from './SetPasswordDialog.svelte';
	import QRDialog from './QRDialog.svelte';
	import IceServerDialog from './IceServerDialog.svelte';
	import ColorPicker from './ColorPicker.svelte';
	import ProgressOverlay from './ProgressOverlay.svelte';
	import DrawingForm from '../map/DrawingForm.svelte';
	import PinDetailModal from '../map/PinDetailModal.svelte';
	import PinForm from '../map/PinForm.svelte';
	import HostModal from './HostModal.svelte';
	import JoinModal from './JoinModal.svelte';

	const COMPONENTS = {
		confirm: ConfirmDialog,
		alert: AlertDialog,
		password: PasswordDialog,
		setPassword: SetPasswordDialog,
		qrAnswer: QRDialog,
		qrHost: QRDialog,
		iceServer: IceServerDialog,
		colorPicker: ColorPicker,
		progress: ProgressOverlay,
		drawingForm: DrawingForm,
		pinDetail: PinDetailModal,
		pinForm: PinForm,
		hostModal: HostModal,
		joinModal: JoinModal,
	};

	let stack = dialogs.stack;
	dialogs.subscribe(v => stack = v);
</script>

{#if stack.length > 0}
{@const top = stack[stack.length - 1]}
{#if COMPONENTS[top.component]}
	<svelte:component this={COMPONENTS[top.component]} {...top.props} />
{/if}
{/if}