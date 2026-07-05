export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div
        className="flex h-18 w-36 items-center justify-center rounded-2xl bg-muted/50 font-bold text-lg uppercase tracking-[0.22em] shadow-lg/10"
        aria-label="Ark splash screen"
      >
        Ark
      </div>
    </div>
  );
}
