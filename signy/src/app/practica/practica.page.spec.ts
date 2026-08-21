import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PracticaPage } from './practica.page';

describe('PracticaPage', () => {
  let component: PracticaPage;
  let fixture: ComponentFixture<PracticaPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PracticaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
