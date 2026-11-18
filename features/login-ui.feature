# Test classification: integration
# Review status: Not Reviewed
# Evidence: synthetic
# Scope: Password masking, keyboard reveal, required-field validation and single Enter submission on an owned synthetic login form in a real browser; not a customer login.
@owned-login-ui
Feature: Review supported login controls on an owned synthetic form

  Scenario: Password visibility toggles without submitting the form
    Given the locally served synthetic login form is open
    When I enter a synthetic password without submitting
    Then the password is masked
    When I reveal the password with the login page object
    Then the password is visible and its synthetic value is unchanged
    When I hide the password with the login page object
    Then the password is masked and the form has not been submitted

  Scenario: Keyboard users can reveal a password without submitting
    Given the locally served synthetic login form is open
    When I enter a synthetic password without submitting
    And I focus and activate the visibility control with the keyboard
    Then the visibility control is accessible and visibly focused
    And the password is revealed without submitting the form

  Scenario: Missing required fields are reported without a form submission
    Given the locally served synthetic login form is open
    When I submit the empty form with the login page object
    Then both required fields report missing values
    And the form has not been submitted

  Scenario: Enter submits the locally completed form exactly once
    Given the locally served synthetic login form is open
    When I enter synthetic account details and press Enter
    Then the local form records exactly one submission
