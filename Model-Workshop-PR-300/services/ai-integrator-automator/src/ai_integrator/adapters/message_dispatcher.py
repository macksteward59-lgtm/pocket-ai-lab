"""In-process event list. This dispatcher does not open a socket."""

from ai_integrator.application.policy import SecurityBoundaryViolationEvent


class InProcessMessageDispatcher:
    def __init__(self) -> None:
        self.events: list[SecurityBoundaryViolationEvent] = []

    def publish(self, event: SecurityBoundaryViolationEvent) -> SecurityBoundaryViolationEvent:
        if event.authorized is not False:
            raise RuntimeError("authorized must stay false")
        self.events.append(event)
        return event
