# Test classification: e2e
# Review status: Not Reviewed
# Evidence: synthetic
# Scope: Readable counterpart of tests/demo.spec.ts; not a second executable case or a registered test identity.
Feature: Fixed owned starter demonstration
  Scenario: Confirm the synthetic demo
    Given the owned synthetic demo is ready
    When I confirm the demo
    Then confirmation is visible
