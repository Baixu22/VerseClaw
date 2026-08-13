import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AgentInteractionRenderer,
  parseToolUiContent,
} from '@/components/tool-ui/agent-interactions';

describe('Tool UI weather rendering', () => {
  it('recognizes the official weather-widget component id without shape guessing', () => {
    const parsed = parseToolUiContent([
      '```tool-ui',
      JSON.stringify({
        type: 'weather-widget',
        location: 'London',
        forecast: [{ day: 'Wed', condition: 'Cloudy', high: 18, low: 11 }],
      }),
      '```',
    ].join('\n'));

    expect(parsed.interactions).toHaveLength(1);
    expect(parsed.interactions[0]).toMatchObject({
      type: 'weather',
      location: 'London',
    });
  });

  it('renders supplied weather data through the official weather widget', () => {
    const source = [
      'Current conditions:',
      '',
      '```tool-ui',
      JSON.stringify({
        type: 'weather-widget',
        id: 'weather-seattle',
        location: 'Seattle, WA',
        temperature: 52,
        unit: 'fahrenheit',
        condition: 'Light rain',
        icon: 'rain',
        humidity: 84,
        windSpeed: 9,
        windUnit: 'mph',
        forecast: [
          { day: 'Mon', condition: 'Rain', high: 55, low: 46 },
          { day: 'Tue', condition: 'Cloudy', high: 57, low: 45 },
        ],
      }),
      '```',
    ].join('\n');
    const parsed = parseToolUiContent(source);

    render(<AgentInteractionRenderer interactions={parsed.interactions} />);

    const widget = screen.getByTestId('chat-tool-ui-weather');
    expect(widget).toHaveTextContent('Seattle, WA');
    expect(widget).toHaveTextContent('52');
    expect(widget).toHaveTextContent('°F');
    // H/L is derived from the forecast span when the payload omits it.
    expect(widget).toHaveTextContent('57°');
    expect(widget).toHaveTextContent('45°');
    expect(screen.getByTestId('chat-tool-ui-weather-icon')).toHaveAttribute('data-weather-icon', 'rain');
    expect(parsed.displayText).not.toContain('"windUnit"');
  });

  it('maps prose conditions onto the widget scene codes', () => {
    const parsed = parseToolUiContent([
      '```tool-ui',
      JSON.stringify({
        type: 'weather-widget',
        id: 'w1',
        location: 'Kansas City, MO',
        temperature: 72,
        unit: 'fahrenheit',
        condition: 'Heavy rain',
        localTimeOfDay: 22,
        forecast: [{ day: 'TUE', condition: 'Partly cloudy', high: 75, low: 62 }],
      }),
      '```',
    ].join('\n'));

    // `heavy rain` must win over the `rain` substring, and the forecast entry
    // keeps its own scene rather than inheriting the current one.
    expect(parsed.interactions[0]).toMatchObject({
      type: 'weather',
      conditionCode: 'heavy-rain',
      localTimeOfDay: 22,
      forecast: [{ conditionCode: 'partly-cloudy' }],
    });
  });
});
