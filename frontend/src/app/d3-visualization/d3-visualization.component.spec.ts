import { ComponentFixture, TestBed } from '@angular/core/testing';

import { D3VisualizationComponent } from './d3-visualization.component';

describe('D3VisualizationComponent', () => {
  let component: D3VisualizationComponent;
  let fixture: ComponentFixture<D3VisualizationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [D3VisualizationComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(D3VisualizationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
