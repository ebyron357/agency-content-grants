import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ConfirmDialogProps {
  /** Element that opens the dialog (e.g. a delete button). */
  trigger: React.ReactNode;
  title: string;
  description: string;
  /** Label for the destructive/confirm button. Defaults to "Delete". */
  confirmLabel?: string;
  onConfirm: () => void;
  /** Disable the confirm action (e.g. while a mutation is pending). */
  disabled?: boolean;
}

/**
 * Standard confirmation dialog for destructive or hard-to-reverse actions.
 * Wrap any trigger element; the action only fires after explicit confirmation.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  disabled,
}: ConfirmDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={disabled}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
